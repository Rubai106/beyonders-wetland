"""Local, reproducible GCOV forest-change screening and immutable publication.

No wetland classifier or optical water rule is used. Historical tree cover is
eligibility context, not current forest truth. Optical change is supporting
evidence, not labelled ground truth. Credentials never enter publications.
"""
import argparse
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import tempfile
import uuid
import warnings
import zipfile

import numpy as np
from PIL import Image
from pyproj import CRS
import rasterio
from rasterio.enums import Resampling
from rasterio.features import geometry_mask, shapes
from rasterio.transform import from_bounds
from rasterio.warp import reproject, transform_bounds
from rasterio.windows import Window, from_bounds as window_from_bounds
from scipy.ndimage import label
from shapely.geometry import box, mapping, shape

from extract_gcov import extract_polarization_to_tiff, extract_quality_layers_to_tiff
from hls_reference import _band_url, _identity, _common_tile_pairs, _read_hls_qa, _qa_clear
from network_retry import remote_call
from raster_utils import atomic_json, read_rasters, area_km2, to_wgs84
from search_nisar import select_compatible_series

ROOT = Path(__file__).resolve().parent.parent
METHOD = "forest-hv-persistence-1.0.0"
OUTPUT = ROOT / "pipeline/output/forests"


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read_config(path):
    config = json.loads(Path(path).read_text(encoding="utf-8"))
    bbox = config["bbox"]
    if (len(bbox) != 4 or not -180 <= bbox[0] < bbox[2] <= 180 or not -85 <= bbox[1] < bbox[3] <= 85
            or not re.fullmatch(r"[a-z0-9-]+", config["id"])):
        raise ValueError("Invalid study ID or WGS84 bounds.")
    dates = config["dates"]
    if dates != sorted(set(dates)) or any(date.fromisoformat(d).isoformat() != d for d in dates):
        raise ValueError("Observation dates must be distinct, ordered ISO dates.")
    if config["baseline_observations"] != 3 or len(dates) < 5 or config["drop_db"] != 3 or config["minimum_patch_ha"] != 1:
        raise ValueError("Method 1.0.0 requires three baseline scenes, a 3 dB drop and 1 ha patches.")
    if config["common_clear_floor"] != .2 or config["optical_tolerance_days"] != 30:
        raise ValueError("The reference protocol requires the 20% floor and 30-day window.")
    return config


def pixel_area(profile):
    if not CRS.from_user_input(profile["crs"]).is_projected:
        raise ValueError("Classification must use the native projected radar grid.")
    t = profile["transform"]
    return area_km2(shape({"type": "Polygon", "coordinates": [[t @ (0,0), t @ (1,0), t @ (1,1), t @ (0,1), t @ (0,0)]]}), profile["crs"])


def write_tif(path, values, profile, nodata=np.nan):
    p = profile.copy()
    p.update(driver="GTiff", count=1, height=values.shape[0], width=values.shape[1], dtype=values.dtype, nodata=nodata, compress="deflate")
    p.pop("blockxsize", None); p.pop("blockysize", None); p.pop("tiled", None)
    path = Path(path)
    tmp = path.with_name(path.name+".partial.tif")
    try:
        with rasterio.open(tmp, "w", **p) as dst:
            dst.write(values, 1)
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def align(values, source_profile, target, categorical=False, average=False):
    result = np.full((target["height"], target["width"]), np.nan, dtype="float32")
    reproject(values.astype("float32"), result, src_transform=source_profile["transform"], src_crs=source_profile["crs"],
              dst_transform=target["transform"], dst_crs=target["crs"], src_nodata=np.nan, dst_nodata=np.nan,
              resampling=Resampling.average if average else Resampling.nearest if categorical else Resampling.bilinear)
    return result


def detector(hh, hv, quality, tree, study, area, drop=3, minimum_ha=1):
    if hh.shape != hv.shape or hh.shape != quality.shape or hh.shape[0] < 5:
        raise ValueError("Aligned HH, HV and quality stacks require at least five observations.")
    valid = quality.astype(bool) & np.isfinite(hh) & np.isfinite(hv) & study[None, ...]
    baseline_valid = valid[:3].all(axis=0)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        baseline = np.median(np.where(valid[:3], hv[:3], np.nan), axis=0)
        baseline_hh = np.median(np.where(valid[:3], hh[:3], np.nan), axis=0)
        mad = np.median(np.abs(hv[:3]-baseline), axis=0)
    baseline[~baseline_valid] = np.nan; baseline_hh[~baseline_valid] = np.nan; mad[~baseline_valid] = np.nan
    eligible = baseline_valid & (tree == 10) & study
    outputs = []
    for i in range(3, len(hv)):
        # Consecutive scheduled observations: an invalid intervening date breaks
        # persistence. First post-baseline observation has no confirmation pair.
        assessed = eligible & valid[i] & valid[i-1] if i > 3 else np.zeros_like(eligible)
        delta = hv[i] - baseline
        candidates = assessed & (delta <= -drop) & (hv[i-1]-baseline <= -drop)
        labels, _ = label(candidates, structure=np.ones((3,3), dtype="uint8"))
        sizes = np.bincount(labels.ravel())
        keep = sizes * area * 100 >= minimum_ha
        keep[0] = False
        candidates = keep[labels]
        classification = np.full(tree.shape, 255, dtype="uint8")
        classification[assessed] = 0; classification[candidates] = 1
        outputs.append({"delta": delta, "classification": classification, "valid": valid[i],
                        "stats": {"candidate_area_km2": float(candidates.sum()*area), "candidate_pixels": int(candidates.sum()),
                                  "patch_count": int(keep.sum()), "assessed_area_km2": float(assessed.sum()*area),
                                  "eligible_area_km2": float(eligible.sum()*area), "study_area_km2": float(study.sum()*area),
                                  "valid_area_km2": float(valid[i].sum()*area),
                                  "median_hh_db": float(np.median(hh[i][valid[i]])) if valid[i].any() else None,
                                  "median_hv_db": float(np.median(hv[i][valid[i]])) if valid[i].any() else None}})
    return baseline, baseline_hh, mad, outputs


def discover(config):
    import earthaccess
    results = remote_call(lambda: earthaccess.search_data(short_name=config["product"], bounding_box=tuple(config["bbox"]),
                temporal=(config["dates"][0], config["dates"][-1]), count=200))
    selected = [(identity, result) for identity, result in select_compatible_series(results, {"nisar": {"frequency": config["frequency"]}})
                if identity["date"] in config["dates"] and identity["compatibility"][4] == config["track"]
                and identity["compatibility"][6] == config["frame"]]
    if [entry[0]["date"] for entry in selected] != config["dates"]:
        raise ValueError("The complete configured compatible series is not available. Do not replace dates silently.")
    return selected


def authenticate():
    import earthaccess
    strategy = "environment" if os.environ.get("EARTHDATA_TOKEN") or os.environ.get("EARTHDATA_USERNAME") else "netrc"
    auth = remote_call(lambda: earthaccess.login(strategy=strategy))
    if not auth.authenticated:
        raise RuntimeError("Sign in privately with earthaccess.login(persist=True) in the local terminal.")


def native_worldcover(config, target, cache):
    path = cache / "worldcover2021.tif"
    if not path.exists():
        def crop():
            with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif"):
                with rasterio.open(config["worldcover_url"]) as source:
                    bounds = transform_bounds("EPSG:4326", source.crs, *config["bbox"])
                    window = window_from_bounds(*bounds, source.transform).round_offsets().round_lengths().intersection(Window(0,0,source.width,source.height))
                    data = source.read(1, window=window, masked=True).filled(0).astype("uint8")
                    profile = source.profile.copy(); profile.update(transform=source.window_transform(window))
                    write_tif(path, data, profile, nodata=0)
        remote_call(crop)
    with rasterio.open(path) as src:
        values = src.read(1, masked=True).astype("float32").filled(np.nan)
        result = align(values, src.profile, target, categorical=True)
    return result


def process(config, run):
    import earthaccess
    signature = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()[:16]
    cache = OUTPUT / "cache" / signature; cache.mkdir(parents=True, exist_ok=True)
    selected = discover(config)
    authenticate()
    inputs = []
    for i, (identity, result) in enumerate(selected):
        print(f"NISAR {i+1}/{len(selected)}: {identity['date']}", flush=True)
        stem = cache / identity["name"]
        hh = stem.with_name(stem.name+"_hh.tif"); hv = stem.with_name(stem.name+"_hv.tif")
        qp = stem.with_name(stem.name+"_quality.json")
        if not (hh.exists() and hv.exists() and qp.exists()):
            handles = remote_call(lambda: earthaccess.open([result], show_progress=False))
            if len(handles) != 1: raise ValueError("Expected one NISAR science file.")
            try:
                if not hh.exists(): remote_call(lambda: extract_polarization_to_tiff(handles[0], config["frequency"], "HHHH", hh, bbox=config["bbox"]))
                if not hv.exists(): remote_call(lambda: extract_polarization_to_tiff(handles[0], config["frequency"], "HVHV", hv, bbox=config["bbox"]))
                if not qp.exists():
                    quality = remote_call(lambda: extract_quality_layers_to_tiff(handles[0], config["frequency"], stem, bbox=config["bbox"]))
                    for key in ("quality_valid_path", "number_of_looks_path", "mask_ensemble_path"):
                        if quality.get(key): quality[key] = Path(quality[key]).name
                    atomic_json(qp, quality)
            finally:
                for handle in handles: handle.close()
        q = json.loads(qp.read_text())
        files = {"hh": hh, "hv": hv, "quality": cache/q["quality_valid_path"],
                 "looks": cache/q["number_of_looks_path"], "quality_metadata": qp}
        if q.get("mask_ensemble_path"): files["ensemble"] = cache/q["mask_ensemble_path"]
        copied = {}
        for kind, path in files.items():
            name = f"{identity['date']}_{kind}{path.suffix}"
            shutil.copy2(path, run/name); copied[kind] = name
        inputs.append({"date": identity["date"], "granule_id": identity["name"],
                       "cmr_concept_id": result.get("meta", {}).get("concept-id"), "collection": config["product"],
                       "maturity": "PROVISIONAL", "frequency": config["frequency"],
                       "compatibility": list(identity["compatibility"]), "files": copied})
    paths = [run/entry["files"][kind] for entry in inputs for kind in ("hh", "hv", "quality")]
    arrays, profile = read_rasters(paths)
    hh = np.stack(arrays[0::3]); hv = np.stack(arrays[1::3]); quality = np.stack(arrays[2::3]) == 1
    # Mask the actual geographic rectangle, not its projected bounding envelope.
    from pyproj import Transformer
    from shapely.ops import transform as transform_geometry
    projected = transform_geometry(Transformer.from_crs(4326, profile["crs"], always_xy=True).transform, box(*config["bbox"]))
    study_mask = geometry_mask([mapping(projected)], out_shape=hh.shape[1:], transform=profile["transform"], invert=True)
    tree = native_worldcover(config, profile, cache)
    shutil.copy2(cache/"worldcover2021.tif", run/"worldcover2021_source.tif")
    write_tif(run/"worldcover2021.tif", tree.astype("float32"), profile)
    write_tif(run/"study_mask.tif", study_mask.astype("uint8"), profile, 255)
    atomic_json(run/"boundary.geojson", {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"source": config["boundary_source"]}, "geometry": mapping(box(*config["bbox"]))}]})
    baseline, baseline_hh, mad, results = detector(hh, hv, quality, tree, study_mask, pixel_area(profile))
    for name, values in (("baseline_hv",baseline),("baseline_hh",baseline_hh),("baseline_mad",mad)):
        write_tif(run/f"{name}.tif", values.astype("float32"), profile)
    frames = []
    for source, frame in zip(inputs[3:], results):
        day = source["date"]
        write_tif(run/f"{day}_classification.tif", frame["classification"], profile, 255)
        write_tif(run/f"{day}_delta_hv.tif", frame["delta"].astype("float32"), profile)
        frames.append({"date": day, "stats": frame["stats"], "reference": {"status":"NOT_CHECKED","reason":"Independent reference has not been read."}})
    manifest = {"schema_version":1,"id":config["id"],"run_id":run.name,"hazard_type":"forest_disturbance",
                "title":config["title"],"created":datetime.now(timezone.utc).isoformat(),"processing_status":"COMPLETE",
                "method_version":METHOD,"scientific_interpretation":"UNVERIFIED_RADAR_CHANGE_CANDIDATES",
                "reference_availability":"NOT_CHECKED","bbox":config["bbox"],"boundary_source":config["boundary_source"],
                "inputs":inputs,"baseline_dates":config["dates"][:3],"frames":frames,
                "pixel_area_km2":pixel_area(profile),"native_crs":str(profile["crs"]),"native_transform":list(profile["transform"]),
                "native_shape":[profile["height"],profile["width"]]}
    atomic_json(run/"manifest.json", manifest)
    atomic_json(run/"config.json", config)
    return manifest


def load_band(granule, band, bounds, cache):
    import earthaccess
    name = _identity(granule)["granule_id"]
    cached = cache/f"{name}_{band}.tif"
    if not cached.exists():
        def crop():
            handles = earthaccess.open([_band_url(granule,band)], show_progress=False)
            try:
                with rasterio.open(handles[0]) as src:
                    window = window_from_bounds(*transform_bounds(4326,src.crs,*bounds),src.transform).round_offsets().round_lengths().intersection(Window(0,0,src.width,src.height))
                    values = src.read(1,window=window,masked=True).astype("float32").filled(np.nan)
                    profile=src.profile.copy(); profile.update(transform=src.window_transform(window))
                    write_tif(cached,values,profile)
            finally:
                for handle in handles: handle.close()
        remote_call(crop)
    with rasterio.open(cached) as src: return src.read(1,masked=True).filled(np.nan),src.profile.copy()


def optical_scene(granule, config, cache):
    product = _identity(granule)["product"]
    bands = {"red":"B04","green":"B03","blue":"B02","nir":"B05" if product=="L30" else "B8A","swir2":"B07" if product=="L30" else "B12","qa":"Fmask"}
    values={}; profile=None
    for name,band in bands.items():
        values[name],p=load_band(granule,band,config["bbox"],cache)
        if profile is None: profile=p
        elif p["crs"]!=profile["crs"] or p["transform"]!=profile["transform"] or values[name].shape!=values["red"].shape:
            raise ValueError("HLS spectral and quality grids must match.")
    qa=np.where(np.isfinite(values["qa"]),values["qa"],255).astype("uint8")
    valid=_qa_clear(qa) & ((qa & 32)==0)
    for name in ("red","nir","swir2","green","blue"):
        valid &= np.isfinite(values[name]) & (values[name]>-9999) & (values[name]<12000)
    for name,other in (("ndvi","red"),("nbr","swir2")):
        denom=values["nir"]+values[other]
        index=np.full(denom.shape,np.nan,dtype="float32")
        good=valid & (denom>0)
        index[good]=(values["nir"][good]-values[other][good])/denom[good]
        values[name]=index
    valid &= np.isfinite(values["ndvi"]) & np.isfinite(values["nbr"])
    for name in ("ndvi","nbr"):
        values[name][~valid]=np.nan
    return values,valid,profile


def support_metrics(candidate_fraction, study_fraction, common, optical_support, pixel_km2, floor=.2):
    study_area=float(study_fraction.sum()*pixel_km2)
    common_area=float((study_fraction*common).sum()*pixel_km2)
    total=float(candidate_fraction.sum()*pixel_km2)
    assessed=float((candidate_fraction*common).sum()*pixel_km2)
    supported=float((candidate_fraction*common*optical_support).sum()*pixel_km2)
    return {"status":"CROSS_SENSOR_CHECK" if study_area and common_area/study_area>=floor else "INCONCLUSIVE",
            "common_clear_fraction":common_area/study_area if study_area else 0.,"common_clear_area_km2":common_area,
            "candidate_assessed_area_km2":assessed,"candidate_supported_area_km2":supported,
            "candidate_without_optical_support_area_km2":max(0.,assessed-supported),
            "candidate_unassessed_area_km2":max(0.,total-assessed),
            "support_overlap_fraction":supported/assessed if assessed and study_area and common_area/study_area>=floor else None,
            "precision":None,"recall":None,"f1":None,
            "metric_note":"Optical index decreases are supporting signatures, not a reference classification with assessed negatives. No accuracy score is inferred."}


def check_reference(run, config):
    import earthaccess
    authenticate()
    manifest=json.loads((run/"manifest.json").read_text())
    cache=OUTPUT/"optical-cache"/hashlib.sha256(json.dumps(config["bbox"]).encode()).hexdigest()[:16]
    cache.mkdir(parents=True,exist_ok=True)
    arrays,radar_profile=read_rasters([run/"study_mask.tif"]); study=arrays[0]==1
    baseline_date=date.fromisoformat(config["dates"][1]); days=config["optical_tolerance_days"]
    start=min(date.fromisoformat(d) for d in config["dates"])-timedelta(days=days)
    end=max(date.fromisoformat(d) for d in config["dates"])+timedelta(days=days)
    granules=[]
    for collection in ("HLSL30","HLSS30"):
        granules.extend(remote_call(lambda: earthaccess.search_data(short_name=collection,bounding_box=tuple(config["bbox"]),temporal=(str(start),str(end)),count=1000)))
    for frame in manifest["frames"]:
        day=frame["date"]; print(f"Independent HLS reference: {day}",flush=True)
        try:
            pairs=_common_tile_pairs(granules,baseline_date,date.fromisoformat(day),days,box(*config["bbox"]))
            # Do not use post-baseline optical images as the before reference;
            # same sensor/tile gives directly comparable native 30 m support.
            pairs=[(a,b) for a,b in pairs if a["product"]==b["product"] and a["date"]<=date.fromisoformat(config["dates"][2]) and b["date"]>date.fromisoformat(config["dates"][2])]
            best=None; attempts=[]
            for first,second in pairs[:config["maximum_optical_pairs"]]:
                try:
                    q1=_read_hls_qa(first["granule"],radar_profile,config["bbox"],cache)
                    q2=_read_hls_qa(second["granule"],radar_profile,config["bbox"],cache)
                    n=int((study & _qa_clear(q1) & _qa_clear(q2) & ((q1&32)==0) & ((q2&32)==0)).sum())
                    attempts.append({"before":first["granule_id"],"after":second["granule_id"],"common_clear_pixels":n})
                    if best is None or n>best[0]: best=(n,first,second)
                except Exception as exc:
                    attempts.append({"before":first["granule_id"],"after":second["granule_id"],"error_type":type(exc).__name__})
            if best is None or best[0]==0: raise ValueError("No readable optical pair with common clear coverage.")
            _,first,second=best
            before,bv,p=optical_scene(first["granule"],config,cache)
            after,av,ap=optical_scene(second["granule"],config,cache)
            if p["crs"]!=ap["crs"] or p["transform"]!=ap["transform"] or bv.shape!=av.shape: raise ValueError("Reference scenes must share the same native HLS grid.")
            p.update(height=bv.shape[0],width=bv.shape[1])
            native_study=align(study.astype("float32"),radar_profile,p,average=True)
            native_study=np.nan_to_num(native_study)
            with rasterio.open(run/f"{day}_classification.tif") as src: candidate=src.read(1)==1
            candidate_fraction=np.nan_to_num(align(candidate.astype("float32"),radar_profile,p,average=True))
            common=bv & av & (native_study>0)
            dn=after["ndvi"]-before["ndvi"]; db=after["nbr"]-before["nbr"]
            # Both indices must decrease. No arbitrary binary clearing truth is
            # invented; index magnitudes and imagery remain visible for review.
            support=common & (dn<0) & (db<0)
            evidence=support_metrics(candidate_fraction,native_study,common,support,pixel_area(p),config["common_clear_floor"])
            evidence.update({"source":"NASA HLS v2.0", "selection":"Greatest common clear QA coverage among the first 12 date/overlap-ranked same-sensor pairs; independent of radar classifications.",
                             "baseline_target":str(baseline_date),"baseline_dates":config["dates"][:3],
                             "before_scene":first["granule_id"],"after_scene":second["granule_id"],"before_date":str(first["date"]),"after_date":str(second["date"]),
                             "before_offset_days":(first["date"]-baseline_date).days,"after_offset_days":(second["date"]-date.fromisoformat(day)).days,
                             "support_rule":"NDVI and NBR both decrease on common clear non-water HLS cells; direction-only exploratory optical support, not forest-loss truth.",
                             "attempts":attempts,"native_hls_cells":int(common.sum()),
                             "median_ndvi_change":float(np.median(dn[common])) if common.any() else None,
                             "median_nbr_change":float(np.median(db[common])) if common.any() else None})
            categories=np.full(bv.shape,255,dtype="uint8")
            categories[common & (candidate_fraction>0) & ~support]=2
            categories[common & (candidate_fraction>0) & support]=1
            categories[(native_study>0) & (candidate_fraction>0) & ~common]=3
            write_tif(run/f"{day}_optical_support.tif",categories,p,255)
            for name,values in (("ndvi_change",dn),("nbr_change",db)):
                values[~common]=np.nan; write_tif(run/f"{day}_{name}.tif",values.astype("float32"),p)
            for side,values,valid in (("before",before,bv),("after",after,av)):
                rgb=np.stack([values[b]*.0001 for b in ("red","green","blue")]).astype("float32")
                rgb[:,~valid]=np.nan
                for index,band in enumerate(("red","green","blue")):
                    write_tif(run/f"{day}_optical_{side}_{band}.tif",rgb[index],p)
            frame["reference"]=evidence
        except Exception as error:
            frame["reference"]={"status":"INCONCLUSIVE","reason":f"Reference unavailable ({type(error).__name__}). No accuracy claim can be made."}
        atomic_json(run/f"{day}_reference.json",frame["reference"])
        atomic_json(run/"manifest.json",manifest)
    manifest["reference_availability"]="AVAILABLE" if any(f["reference"].get("before_scene") for f in manifest["frames"]) else "UNAVAILABLE"
    # Automatic screening cannot approve a scientific interpretation.
    manifest["scientific_interpretation"]="UNVERIFIED_RADAR_CHANGE_CANDIDATES"
    atomic_json(run/"manifest.json",manifest)


def import_glad(run, raster, metadata_path):
    metadata=json.loads(Path(metadata_path).read_text())
    for key in ("source_url","retrieved","date_encoding","confidence_values","alert_date_range","alert_values"):
        if key not in metadata: raise ValueError(f"GLAD metadata requires {key}.")
    if not metadata["source_url"].startswith(("https://glad.","https://www.globalforestwatch.org/")):
        raise ValueError("Use an official GLAD-S2 export source.")
    with rasterio.open(raster) as src:
        if src.count!=1 or src.crs is None: raise ValueError("GLAD export requires one georeferenced categorical band.")
    shutil.copy2(raster,run/"glad_s2_source.tif")
    atomic_json(run/"glad_s2_metadata.json",{**metadata,"interpretation":"Positive alert evidence only. Missing alerts are not assessed negatives; do not estimate forest-loss area from alerts."})
    manifest=json.loads((run/"manifest.json").read_text())
    manifest["glad"]={"raster":"glad_s2_source.tif","metadata":"glad_s2_metadata.json","status":"IMPORTED_POSITIVE_EVIDENCE"}
    atomic_json(run/"manifest.json",manifest)


def verify_run(run):
    """Recompute all classifications/statistics offline without altering a run."""
    manifest=json.loads((run/"manifest.json").read_text())
    if manifest["method_version"]!=METHOD: raise ValueError("Use the publication's matching method version.")
    arrays,profile=read_rasters([run/item["files"][kind] for item in manifest["inputs"] for kind in ("hh","hv","quality")])
    context,_=read_rasters([run/"worldcover2021.tif",run/"study_mask.tif"])
    output=detector(np.stack(arrays[0::3]),np.stack(arrays[1::3]),np.stack(arrays[2::3])==1,context[0],context[1]==1,pixel_area(profile))[3]
    for frame,result in zip(manifest["frames"],output):
        stored,_=read_rasters([run/f"{frame['date']}_classification.tif"])
        classification=np.where(np.isfinite(stored[0]),stored[0],255).astype("uint8")
        if not np.array_equal(classification,result["classification"]) or frame["stats"]!=result["stats"]:
            raise ValueError(f"Saved classification/statistics differ on {frame['date']}.")
        print(f"{frame['date']}: exact classification and statistics reproduced",flush=True)


def display_profile(config):
    w,s,e,n=config["bbox"]; spacing=config["display_spacing_degrees"]
    width=math.ceil((e-w)/spacing); height=math.ceil((n-s)/spacing)
    return {"crs":"EPSG:4326","transform":from_bounds(w,s,e,n,width,height),"width":width,"height":height}


def render_layer(run, path, target, name, low, high, kind="continuous"):
    with rasterio.open(path) as src:
        native=src.read(1,masked=True).astype("float32").filled(np.nan)
        values=align(native,src.profile,target,categorical=kind!="continuous")
    valid=np.isfinite(values)
    rgba=np.zeros((*values.shape,4),dtype="uint8")
    if kind=="classification":
        rgba[valid & (values==1)]=[255,182,70,245]
    elif kind=="support":
        for value,color in ((1,[40,185,125,245]),(2,[224,105,62,245]),(3,[154,162,174,220])): rgba[valid & (values==value)]=color
    elif kind=="tree":
        rgba[valid & (values==10)]=[42,148,75,170]
    else:
        import matplotlib
        from matplotlib import colormaps
        norm=np.clip(np.nan_to_num((values-low)/(high-low)),0,1)
        rgba=(colormaps["RdBu_r" if low<0 and high>0 else "viridis"](norm)*255).astype("uint8"); rgba[~valid,3]=0
    Image.fromarray(rgba).save(target["directory"]/f"{name}.png")
    return {"image":f"{name}.png","minimum":low,"maximum":high,"unit":"class" if kind!="continuous" else "index" if "ndvi" in name or "nbr" in name else "dB"}


def publish(run, version, native_download_url=None):
    if not re.fullmatch(r"[a-zA-Z0-9.-]+",version): raise ValueError("Invalid publication version.")
    if native_download_url and not native_download_url.startswith("https://github.com/"):
        raise ValueError("Native download must use an HTTPS GitHub Release URL.")
    manifest=json.loads((run/"manifest.json").read_text()); config=read_config(run/"config.json")
    if manifest["processing_status"]!="COMPLETE": raise ValueError("Only complete runs can be published.")
    parent=ROOT/"public/forests"/config["id"]; parent.mkdir(parents=True,exist_ok=True)
    dest=parent/version
    if dest.exists(): raise ValueError("Immutable publication already exists. Choose a new version.")
    stage=Path(tempfile.mkdtemp(prefix=".publication-",dir=OUTPUT))
    try:
        target=display_profile(config); target["directory"]=stage
        study={**manifest,"publication_version":version,"layers":{},"frames":[],
               "limitations":["Historical 2021 tree cover is not current forest truth.","Fixed exploratory thresholds have not been independently calibrated.","Moisture, seasonal changes, land management and speckle can alter backscatter.","Optical dates may differ by up to 30 days; optical index decreases do not uniquely identify clearing.","No global forest-loss, illegal-logging, biomass or carbon estimate is produced."],
               "sources":{"worldcover":config["worldcover_source"],"nisar":"https://nisar-docs.asf.alaska.edu/products-overview/","hls":"https://hls.gsfc.nasa.gov/","glad":"https://glad.umd.edu/dataset/glad-forest-alerts"}}
        for entry in study["inputs"]:
            entry["subset_sha256"]={kind:digest(run/name) for kind,name in entry["files"].items()}
        study["worldcover"]={"year":2021,"version":"v200","class":10,"source_url":config["worldcover_url"],"subset_sha256":digest(run/"worldcover2021_source.tif")}
        for name,path,lo,hi,kind in (("baseline_hv","baseline_hv.tif",-30,-5,"continuous"),("baseline_hh","baseline_hh.tif",-25,0,"continuous"),("baseline_mad","baseline_mad.tif",0,5,"continuous"),("tree_cover","worldcover2021.tif",0,10,"tree")):
            study["layers"][name]=render_layer(run,run/path,target,name,lo,hi,kind)
        for frame in manifest["frames"]:
            day=frame["date"]; layers={}
            with rasterio.open(run/f"{day}_classification.tif") as src:
                classified=src.read(1)
                assessed=np.where(classified!=255,1,np.nan).astype("float32")
                write_tif(run/f"{day}_assessed.tif",assessed,src.profile)
            for name,path,lo,hi,kind in (("hh",f"{day}_hh.tif",-25,0,"continuous"),("hv",f"{day}_hv.tif",-30,-5,"continuous"),("delta_hv",f"{day}_delta_hv.tif",-6,6,"continuous"),("quality",f"{day}_quality.tif",0,1,"quality"),("candidates",f"{day}_classification.tif",0,1,"classification"),("optical_support",f"{day}_optical_support.tif",1,3,"support"),("ndvi_change",f"{day}_ndvi_change.tif",-.5,.5,"continuous"),("nbr_change",f"{day}_nbr_change.tif",-.5,.5,"continuous")):
                if (run/path).exists(): layers[name]=render_layer(run,run/path,target,f"{day}_{name}",lo,hi,kind)
            layers["assessed"]=render_layer(run,run/f"{day}_assessed.tif",target,f"{day}_assessed",0,1,"quality")
            for side in ("before","after"):
                files=[run/f"{day}_optical_{side}_{band}.tif" for band in ("red","green","blue")]
                if all(p.exists() for p in files):
                    channels=[]
                    for path in files:
                        with rasterio.open(path) as src: channels.append(align(src.read(1,masked=True).filled(np.nan),src.profile,target))
                    channels=np.stack(channels,axis=-1); rgba=np.zeros((*channels.shape[:2],4),dtype="uint8")
                    rgba[:,:,:3]=(np.clip(np.nan_to_num(channels)/.3,0,1)**.65*255).astype("uint8")
                    rgba[:,:,3]=np.isfinite(channels).all(axis=-1).astype("uint8")*255
                    name=f"{day}_optical_{side}.png"; Image.fromarray(rgba).save(stage/name)
                    layers[f"optical_{side}"]={"image":name,"unit":"RGB","minimum":0,"maximum":.3}
            # True native candidate polygons, never classified from the PNG.
            with rasterio.open(run/f"{day}_classification.tif") as src:
                data=src.read(1); features=[]
                for geom,value in shapes(data,mask=data==1,transform=src.transform,connectivity=8):
                    native=shape(geom)
                    features.append({"type":"Feature","geometry":mapping(to_wgs84(native,src.crs)),"properties":{"date":day,"area_km2":area_km2(native,src.crs),"interpretation":"UNVERIFIED_RADAR_CHANGE_CANDIDATE"}})
            geo=f"{day}_candidates.geojson"; atomic_json(stage/geo,{"type":"FeatureCollection","features":features})
            study["frames"].append({**frame,"layers":layers,"candidates_geojson":geo})
        if manifest.get("glad"):
            # Decode explicit positive categories; do not interpret zero/NoData
            # as unchanged. Keep the original encoding and dates downloadable.
            with rasterio.open(run/"glad_s2_source.tif") as src:
                raw=src.read(1,masked=True).astype("float32").filled(np.nan)
                meta=json.loads((run/"glad_s2_metadata.json").read_text())
                positive=np.isin(raw,meta["alert_values"]).astype("float32"); positive[~np.isfinite(raw)]=np.nan
                aligned=align(positive,src.profile,target,categorical=True)
                rgba=np.zeros((*aligned.shape,4),dtype="uint8"); rgba[aligned==1]=[234,90,169,220]
                Image.fromarray(rgba).save(stage/"glad_positive.png")
            study["glad"]={**manifest["glad"],"image":"glad_positive.png","details":meta}
        shutil.copy2(run/"boundary.geojson",stage/"boundary.geojson")
        atomic_json(stage/"study.json",study)
        native=stage/"native"; native.mkdir()
        for path in run.iterdir():
            if path.suffix in (".tif",".json",".geojson") and path.name not in ("progress.json",): shutil.copy2(path,native/path.name)
        for name in ("forest_pipeline.py","extract_gcov.py","search_nisar.py","network_retry.py","hls_reference.py","raster_utils.py","requirements.txt"):
            shutil.copy2(ROOT/"pipeline"/name,native/name)
        (stage/"evidence-card.md").write_text(f"# {config['title']}\n\nRun: {manifest['run_id']}\n\nMethod: {METHOD}\n\nInterpretation: {manifest['scientific_interpretation']}\n\nBoundary: {config['boundary_source']}\n\nThree-date HV baseline; 3 dB decrease on two consecutive valid later dates; historical 2021 tree-cover eligibility; minimum 1 hectare patches.\n\nHLS support is exploratory, not a labelled forest-loss reference. No precision, recall or F1 is claimed. See study.json for per-date observations, masks, assessed coverage and temporal offsets.\n",encoding="utf-8")
        # Native crops stay in an operator-managed release asset. The public
        # package remains small and never embeds private local storage paths.
        native_files=[p for p in native.iterdir() if p.is_file()]
        atomic_json(native/"checksums.json",{p.name:digest(p) for p in native_files})
        shutil.copy2(native/"checksums.json",stage/"native-checksums.json")
        downloads=OUTPUT/"publication-downloads"; downloads.mkdir(parents=True,exist_ok=True)
        native_archive=downloads/f"{config['id']}-{version}-native.zip"
        if native_archive.exists(): raise ValueError("Native release asset already exists; choose a new version.")
        with zipfile.ZipFile(native_archive,"w",zipfile.ZIP_DEFLATED) as archive:
            for path in native.iterdir():
                if path.is_file(): archive.write(path,path.name)
        native_sha256=digest(native_archive)
        # Keep reproducibility scripts/config/provenance in the compact package.
        for path in native.iterdir():
            if path.suffix in (".py", ".txt") or path.name in ("manifest.json","config.json","glad_s2_metadata.json"):
                shutil.copy2(path,stage/path.name)
        if not native.resolve().is_relative_to(OUTPUT.resolve()): raise ValueError("Publication staging escaped operator storage.")
        shutil.rmtree(native)
        files=[p for p in stage.rglob("*") if p.is_file()]
        atomic_json(stage/"checksums.json",{p.relative_to(stage).as_posix():digest(p) for p in files})
        with zipfile.ZipFile(stage/"evidence.zip","w",zipfile.ZIP_DEFLATED) as archive:
            for path in stage.rglob("*"):
                if path.is_file() and path.name!="evidence.zip": archive.write(path,path.relative_to(stage))
        os.replace(stage,dest)
        base=f"/forests/{config['id']}/{version}"
        index={"version":version,"study_url":f"{base}/study.json","evidence_url":f"{base}/evidence.zip","checksums_url":f"{base}/checksums.json","archive_sha256":digest(dest/"evidence.zip"),"native_archive_sha256":native_sha256}
        if native_download_url:
            index["native_download_url"]=native_download_url
        atomic_json(parent/"index.json",index)
        catalog_path=ROOT/"public/forests/catalog.json"
        catalog=json.loads(catalog_path.read_text()) if catalog_path.exists() else {"schema_version":1,"hazard_type":"forest_disturbance","studies":[]}
        catalog["studies"]=[s for s in catalog["studies"] if s["id"]!=config["id"]]+[{"id":config["id"],"title":config["title"],"bbox":config["bbox"],"path":f"/forest/{config['id']}","index_url":f"/forests/{config['id']}/index.json","publication_version":version,"method_version":METHOD,"run_id":manifest["run_id"],"processing_status":"COMPLETE","scientific_interpretation":manifest["scientific_interpretation"],"reference_availability":manifest["reference_availability"],"available_dates":config["dates"]}]
        atomic_json(catalog_path,catalog)
        print(f"Published {base}",flush=True)
    finally:
        if stage.exists() and stage.resolve().is_relative_to(OUTPUT.resolve()): shutil.rmtree(stage)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action",choices=("discover","process","reference","import-glad","publish","verify-run"))
    parser.add_argument("--config",default=str(ROOT/"pipeline/forest_rondonia.json"))
    parser.add_argument("--run"); parser.add_argument("--version"); parser.add_argument("--raster"); parser.add_argument("--metadata")
    parser.add_argument("--native-download-url",help="Optional HTTPS GitHub Release URL for the native subset archive")
    args=parser.parse_args(); config=read_config(args.config)
    OUTPUT.mkdir(parents=True,exist_ok=True)
    if args.action=="discover":
        print(json.dumps([{"date":i["date"],"granule_id":i["name"]} for i,_ in discover(config)],indent=2)); return
    run=OUTPUT/"runs"/(args.run or uuid.uuid4().hex)
    if args.run and not re.fullmatch(r"[a-f0-9]{32}",args.run): raise ValueError("Invalid run ID.")
    if args.action!="process" and not (run/"manifest.json").exists(): raise ValueError("Specify an existing --run ID.")
    if args.action=="verify-run": verify_run(run); return
    if args.action=="publish" and not args.version: parser.error("publish requires --version")
    lock=ROOT/"pipeline/output/.run.lock"; lock.parent.mkdir(parents=True,exist_ok=True)
    descriptor=os.open(lock,os.O_CREAT|os.O_EXCL|os.O_WRONLY)
    try:
        os.write(descriptor,str(os.getpid()).encode()); os.close(descriptor)
        if args.action=="process":
            run.mkdir(parents=True,exist_ok=False)
            atomic_json(run/"progress.json",{"status":"RUNNING","run_id":run.name})
            print(f"Forest run: {run.name}",flush=True)
            try:
                process(config,run)
                atomic_json(run/"progress.json",{"status":"COMPLETE","run_id":run.name})
            except Exception as exc:
                atomic_json(run/"progress.json",{"status":"FAILED","error_type":type(exc).__name__,"run_id":run.name})
                raise
        elif args.action=="reference": check_reference(run,read_config(run/"config.json"))
        elif args.action=="import-glad":
            if not args.raster or not args.metadata: parser.error("import-glad requires --raster and --metadata")
            import_glad(run,args.raster,args.metadata)
        else: publish(run,args.version,args.native_download_url)
        print(f"Forest run: {run.name}",flush=True)
    finally:
        lock.unlink(missing_ok=True)


if __name__=="__main__": main()
