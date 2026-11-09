"""Audit exact Chókwè pixels and positive-only support from close-date GFM COGs.

This reads only the Chókwè AOI window from 17 January 2026 GFM assets.
Published NISAR candidate polygons are rasterized onto the GFM grid using
pixel-center inclusion. Results are positive-only cross-sensor support, not
field truth or an accuracy assessment.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import numpy as np
import rasterio
from rasterio.features import bounds as geometry_bounds
from rasterio.features import geometry_mask, rasterize
from rasterio.warp import transform_geom
from rasterio.windows import Window, from_bounds

import discover_chokwe_gfm as discovery


ROOT = Path(__file__).resolve().parent.parent
STUDY_GEOMETRY = {
    "type": "Polygon",
    "coordinates": [[
        [32.93, -24.58],
        [33.03, -24.58],
        [33.03, -24.48],
        [32.93, -24.48],
        [32.93, -24.58],
    ]],
}
EVENT_DATE = "2026-01-17"
NISAR_EVENT_TIME = "2026-01-17T03:42:32Z"
ASSET_NAMES = (
    "ensemble_flood_extent",
    "ensemble_likelihood",
    "ensemble_water_extent",
    "exclusion_mask",
    "reference_water_mask",
    "advisory_flags",
    "list_flood_extent",
    "dlr_flood_extent",
    "tuw_flood_extent",
    "list_likelihood",
    "dlr_likelihood",
    "tuw_likelihood",
)
PATCHES_PATH = (
    ROOT
    / "public"
    / "studies"
    / "releases"
    / "2026.10.29-chokwe"
    / "runs"
    / "ec8fa5ee15ae41d1aa89f930f2b47e36"
    / "patches_final.geojson"
)
DEFAULT_OUTPUT = (
    Path(__file__).resolve().parent
    / "output"
    / "reference-cache"
    / "chokwe_gfm_pixel_audit.json"
)
API_HOST = "data.eodc.eu"


def select_event_items(items: list[dict], event_date: str = EVENT_DATE) -> list[dict]:
    """Select and chronologically sort source items for the NISAR event date."""
    selected = []
    for item in items:
        properties = item.get("properties")
        if not isinstance(properties, dict):
            continue
        timestamp = properties.get("datetime")
        if isinstance(timestamp, str) and timestamp[:10] == event_date:
            selected.append(item)
    return sorted(selected, key=lambda item: (
        item["properties"].get("datetime", ""),
        item.get("id", ""),
    ))


def value_histogram(values: np.ndarray) -> dict[str, int]:
    """Return deterministic counts for all observed raster values."""
    unique, counts = np.unique(values, return_counts=True)
    return {str(value.item()): int(count) for value, count in zip(unique, counts)}


def _safe_asset_url(asset: dict, item_id: str, asset_name: str) -> str:
    href = asset.get("href")
    parsed = urlparse(href if isinstance(href, str) else "")
    if (
        parsed.scheme != "https"
        or parsed.hostname != API_HOST
        or not parsed.path.lower().endswith((".tif", ".tiff"))
    ):
        raise ValueError(f"Refusing unexpected URL for {item_id}/{asset_name}.")
    return href


def _window_for_geometry(src, projected_geometry: dict) -> Window:
    bounds = geometry_bounds(projected_geometry)
    requested = from_bounds(*bounds, transform=src.transform)
    requested = requested.round_offsets().round_lengths()
    full = Window(0, 0, src.width, src.height)
    try:
        clipped = requested.intersection(full)
    except Exception as error:
        raise ValueError("The Chókwè geometry does not intersect the GFM raster.") from error
    if clipped.width <= 0 or clipped.height <= 0:
        raise ValueError("The Chókwè geometry does not intersect the GFM raster.")
    return clipped


def read_asset_window(url: str, expected_grid: dict | None = None) -> dict:
    """Read a small exact-AOI window from a public COG over HTTP range requests."""
    with rasterio.Env(
        GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
        CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif,.tiff",
        GDAL_HTTP_MULTIRANGE="YES",
        GDAL_CACHEMAX=128,
    ):
        with rasterio.open(url) as src:
            if src.crs is None or src.count != 1:
                raise ValueError("GFM source raster must have a CRS and one band.")

            grid = {
                "crs": src.crs.to_string(),
                "width": int(src.width),
                "height": int(src.height),
                "transform": [float(value) for value in src.transform[:6]],
            }
            if expected_grid is not None and grid != expected_grid:
                raise ValueError("GFM layers for one acquisition do not share an identical grid.")

            projected = transform_geom("EPSG:4326", src.crs, STUDY_GEOMETRY)
            window = _window_for_geometry(src, projected)
            data = src.read(1, window=window, masked=False)
            source_mask = src.read_masks(1, window=window) > 0
            transform = src.window_transform(window)
            inside_aoi = geometry_mask(
                [projected],
                out_shape=data.shape,
                transform=transform,
                all_touched=False,
                invert=True,
            )
            finite = np.isfinite(data)
            nodata = src.nodata
            if nodata is not None and math.isfinite(float(nodata)):
                finite &= data != nodata
            valid = inside_aoi & source_mask & finite
            tags = {
                str(key): str(value)[:500]
                for key, value in src.tags().items()
            }
            raster = {
                "driver": src.driver,
                "dtype": src.dtypes[0],
                "nodata": nodata,
                "compression": src.compression.value if src.compression else None,
                "block_shapes": [list(shape) for shape in src.block_shapes],
                "descriptions": list(src.descriptions),
                "tags": tags,
            }
            return {
                "data": data,
                "valid": valid,
                "inside_aoi": inside_aoi,
                "transform": transform,
                "window": window,
                "grid": grid,
                "raster": raster,
            }


def inspect_asset(url: str, expected_grid: dict | None = None) -> dict:
    """Summarize a source asset without retaining its array in the report."""
    loaded = read_asset_window(url, expected_grid=expected_grid)
    values = loaded["data"][loaded["valid"]]
    inside_count = int(loaded["inside_aoi"].sum())
    valid_count = int(loaded["valid"].sum())
    if inside_count == 0:
        raise ValueError("The projected Chókwè AOI contains no raster pixel centers.")
    window = loaded["window"]
    return {
        "grid": loaded["grid"],
        "raster": loaded["raster"],
        "window": {
            "row_off": int(window.row_off),
            "col_off": int(window.col_off),
            "height": int(window.height),
            "width": int(window.width),
            "aoi_pixel_centers": inside_count,
        },
        "coverage": {
            "valid_pixel_count": valid_count,
            "invalid_or_nodata_pixel_count": inside_count - valid_count,
            "valid_fraction_of_aoi": valid_count / inside_count,
            "value_histogram_on_valid_aoi_pixels": value_histogram(values),
        },
    }


def harmonize_algorithm_likelihoods(
    algorithm_layers: dict[str, dict],
    algorithm_likelihood_layers: dict[str, dict],
) -> tuple[np.ndarray, np.ndarray]:
    """Apply the published LIST/DLR/TUW harmonization before averaging.

    LIST values are already flood probabilities on a 0–100 scale.
    DLR fuzzy values are piecewise transformed to the same scale.
    TUW uncertainty is inverted only where TUW classifies a pixel as flooded.
    Missing algorithm inputs are omitted from the pixelwise arithmetic mean.
    """
    required_flood = ("list_flood_extent", "dlr_flood_extent", "tuw_flood_extent")
    required_likelihood = ("list_likelihood", "dlr_likelihood", "tuw_likelihood")
    if set(algorithm_layers) != set(required_flood):
        raise ValueError("Exactly the LIST, DLR and TUW flood layers are required.")
    if set(algorithm_likelihood_layers) != set(required_likelihood):
        raise ValueError("Exactly the LIST, DLR and TUW likelihood/uncertainty layers are required.")

    shapes = {
        np.asarray(algorithm_layers[name]["data"]).shape for name in required_flood
    }
    shapes.update(
        np.asarray(algorithm_layers[name]["valid"]).shape for name in required_flood
    )
    shapes.update(
        np.asarray(algorithm_likelihood_layers[name]["data"]).shape
        for name in required_likelihood
    )
    shapes.update(
        np.asarray(algorithm_likelihood_layers[name]["valid"]).shape
        for name in required_likelihood
    )
    if len(shapes) != 1:
        raise ValueError("All algorithm flood and likelihood layers must share one array shape.")

    list_data = np.asarray(algorithm_likelihood_layers["list_likelihood"]["data"], dtype=np.float64)
    dlr_fuzzy = np.asarray(algorithm_likelihood_layers["dlr_likelihood"]["data"], dtype=np.float64)
    tuw_uncertainty = np.asarray(algorithm_likelihood_layers["tuw_likelihood"]["data"], dtype=np.float64)
    tuw_flood = np.asarray(algorithm_layers["tuw_flood_extent"]["data"])

    list_valid = np.asarray(algorithm_likelihood_layers["list_likelihood"]["valid"], dtype=bool)
    dlr_valid = np.asarray(algorithm_likelihood_layers["dlr_likelihood"]["valid"], dtype=bool)
    tuw_valid = np.asarray(algorithm_likelihood_layers["tuw_likelihood"]["valid"], dtype=bool)

    for name, values, valid in (
        ("LIST likelihood", list_data, list_valid),
        ("DLR fuzzy value", dlr_fuzzy, dlr_valid),
        ("TUW uncertainty", tuw_uncertainty, tuw_valid),
    ):
        if np.any(~np.isfinite(values[valid])):
            raise ValueError(f"{name} contains non-finite values on valid pixels.")
        if np.any((values[valid] < 0) | (values[valid] > 100)):
            raise ValueError(f"{name} contains values outside the documented 0–100 range.")

    dlr_likelihood = np.where(
        dlr_fuzzy >= 60,
        100.0 - 1.25 * (100.0 - dlr_fuzzy),
        dlr_fuzzy / 1.2,
    )
    tuw_likelihood = np.where(tuw_flood == 1, 100.0 - tuw_uncertainty, tuw_uncertainty)

    component_values = (
        (list_data, list_valid),
        (dlr_likelihood, dlr_valid),
        (tuw_likelihood, tuw_valid),
    )
    shape = list_data.shape
    total = np.zeros(shape, dtype=np.float64)
    count = np.zeros(shape, dtype=np.uint8)
    for values, valid in component_values:
        total[valid] += values[valid]
        count[valid] += 1

    mean = np.full(shape, np.nan, dtype=np.float64)
    has_input = count > 0
    mean[has_input] = total[has_input] / count[has_input]
    return mean, count


def summarize_algorithm_consistency(
    ensemble_flood: np.ndarray,
    ensemble_likelihood: np.ndarray,
    exclusion: np.ndarray,
    exclusion_valid: np.ndarray,
    reference_water: np.ndarray,
    reference_valid: np.ndarray,
    inside_aoi: np.ndarray,
    algorithm_layers: dict[str, dict],
    algorithm_likelihood_layers: dict[str, dict],
    candidate_mask: np.ndarray | None = None,
    advisory_flags: np.ndarray | None = None,
    advisory_valid: np.ndarray | None = None,
    ensemble_likelihood_valid: np.ndarray | None = None,
) -> dict:
    """Check final binary flood class against LIST/DLR/TUW majority votes."""
    required = ("list_flood_extent", "dlr_flood_extent", "tuw_flood_extent")
    required_likelihood = ("list_likelihood", "dlr_likelihood", "tuw_likelihood")
    if set(algorithm_layers) != set(required):
        raise ValueError("Exactly the LIST, DLR and TUW flood layers are required.")
    if set(algorithm_likelihood_layers) != set(required_likelihood):
        raise ValueError("Exactly the LIST, DLR and TUW likelihood/uncertainty layers are required.")
    arrays = [
        ensemble_flood, ensemble_likelihood, exclusion, exclusion_valid,
        reference_water, reference_valid, inside_aoi,
    ]
    arrays.extend(algorithm_layers[name]["data"] for name in required)
    arrays.extend(algorithm_layers[name]["valid"] for name in required)
    arrays.extend(algorithm_likelihood_layers[name]["data"] for name in required_likelihood)
    arrays.extend(algorithm_likelihood_layers[name]["valid"] for name in required_likelihood)
    if candidate_mask is not None:
        arrays.append(candidate_mask)
    if advisory_flags is not None:
        arrays.append(advisory_flags)
    if advisory_valid is not None:
        arrays.append(advisory_valid)
    if ensemble_likelihood_valid is not None:
        arrays.append(ensemble_likelihood_valid)
    if len({array.shape for array in arrays}) != 1:
        raise ValueError("All GFM algorithm, ensemble and mask arrays must share one grid window.")

    harmonized_mean, harmonized_input_count = harmonize_algorithm_likelihoods(
        algorithm_layers, algorithm_likelihood_layers
    )
    ensemble_likelihood_valid = (
        inside_aoi.astype(bool)
        if ensemble_likelihood_valid is None
        else ensemble_likelihood_valid.astype(bool)
    )
    formula_comparison_mask = (
        inside_aoi.astype(bool)
        & ensemble_likelihood_valid
        & (harmonized_input_count > 0)
    )
    formula_observed = ensemble_likelihood.astype(np.float64)[formula_comparison_mask]
    formula_expected = harmonized_mean[formula_comparison_mask]
    formula_residual = formula_observed - formula_expected
    formula_rounded = np.rint(formula_expected)
    formula_eligible_mask = (
        inside_aoi.astype(bool)
        & exclusion_valid.astype(bool)
        & reference_valid.astype(bool)
        & np.logical_and.reduce([
            algorithm_layers[name]["valid"].astype(bool)
            for name in ("list_flood_extent", "dlr_flood_extent", "tuw_flood_extent")
        ])
        & (exclusion == 0)
        & (reference_water == 0)
    )
    low_flood_formula_mask = (
        formula_eligible_mask
        & ensemble_likelihood_valid
        & (ensemble_flood == 1)
        & (ensemble_likelihood < 50)
        & (harmonized_input_count > 0)
    )
    low_likelihood_positive = (
        formula_eligible_mask
        & (ensemble_flood == 1)
        & (ensemble_likelihood < 50)
    )
    low_flood_expected = harmonized_mean[low_flood_formula_mask]
    formula_input_histogram = {
        str(number): int(np.count_nonzero(formula_comparison_mask & (harmonized_input_count == number)))
        for number in (1, 2, 3)
    }
    low_flood_observed = ensemble_likelihood.astype(np.float64)[low_flood_formula_mask]
    low_flood_residual = low_flood_observed - low_flood_expected
    low_flood_candidate_mask = (
        low_flood_formula_mask & candidate_mask.astype(bool)
        if candidate_mask is not None
        else np.zeros(ensemble_flood.shape, dtype=bool)
    )
    low_flood_candidate_expected = harmonized_mean[low_flood_candidate_mask]
    low_flood_candidate_observed = ensemble_likelihood.astype(np.float64)[low_flood_candidate_mask]
    low_flood_component_class_counts = {}
    for name in required:
        selected = algorithm_layers[name]["data"][low_likelihood_positive]
        low_flood_component_class_counts[name] = {
            "flood_class_pixels": int(np.count_nonzero(selected == 1)),
            "non_flood_class_pixels": int(np.count_nonzero(selected == 0)),
        }

    low_flood_mismatch_examples = []
    mismatch_rows, mismatch_cols = np.where(
        low_flood_formula_mask & (np.abs(
            ensemble_likelihood.astype(np.float64) - harmonized_mean
        ) > 1.0)
    )
    for row, col in zip(mismatch_rows[:25], mismatch_cols[:25]):
        list_raw = float(algorithm_likelihood_layers["list_likelihood"]["data"][row, col])
        dlr_raw = float(algorithm_likelihood_layers["dlr_likelihood"]["data"][row, col])
        tuw_raw = float(algorithm_likelihood_layers["tuw_likelihood"]["data"][row, col])
        tuw_class = int(algorithm_layers["tuw_flood_extent"]["data"][row, col])
        dlr_harmonized = (
            100.0 - 1.25 * (100.0 - dlr_raw) if dlr_raw >= 60 else dlr_raw / 1.2
        )
        tuw_harmonized = 100.0 - tuw_raw if tuw_class == 1 else tuw_raw
        component_values = {
            "list_likelihood": {"class": int(algorithm_layers["list_flood_extent"]["data"][row, col]), "raw": list_raw, "harmonized": list_raw},
            "dlr_likelihood": {"class": int(algorithm_layers["dlr_flood_extent"]["data"][row, col]), "raw": dlr_raw, "harmonized": dlr_harmonized},
            "tuw_likelihood": {"class": tuw_class, "raw_uncertainty": tuw_raw, "harmonized": tuw_harmonized},
        }
        advisory_value = None
        if advisory_flags is not None and advisory_valid is not None and advisory_valid[row, col]:
            advisory_value = int(advisory_flags[row, col])
        low_flood_mismatch_examples.append({
            "window_row": int(row),
            "window_col": int(col),
            "candidate_display_polygon": bool(candidate_mask[row, col]) if candidate_mask is not None else False,
            "ensemble_binary_flood": int(ensemble_flood[row, col]),
            "ensemble_likelihood": int(ensemble_likelihood[row, col]),
            "harmonized_component_mean": float(harmonized_mean[row, col]),
            "residual_published_minus_reconstructed": float(
                ensemble_likelihood[row, col] - harmonized_mean[row, col]
            ),
            "algorithm_components": component_values,
            "advisory_flag": advisory_value,
            "exclusion_mask": int(exclusion[row, col]),
            "reference_water_mask": int(reference_water[row, col]),
        })

    formula_summary = {
        "formula": (
            "LIST probability; DLR fuzzy F transformed as 100 - 1.25*(100-F) for F>=60, "
            "otherwise F/1.2; TUW uncertainty U transformed as 100-U where TUW flood=1, "
            "otherwise U; arithmetic mean of available valid inputs."
        ),
        "source": "Krullikowski et al. (2023), GFM ensemble likelihood paper, equations (4)–(5) and Section III.A.",
        "valid_comparison_pixel_count": int(formula_comparison_mask.sum()),
        "valid_component_input_count_histogram": formula_input_histogram,
        "rounded_exact_match_count": int(np.count_nonzero(formula_observed == formula_rounded)),
        "within_one_value_count": int(np.count_nonzero(np.abs(formula_residual) <= 1.0)),
        "mean_absolute_residual": float(np.mean(np.abs(formula_residual))) if formula_residual.size else None,
        "median_absolute_residual": float(np.median(np.abs(formula_residual))) if formula_residual.size else None,
        "p95_absolute_residual": float(np.percentile(np.abs(formula_residual), 95)) if formula_residual.size else None,
        "maximum_absolute_residual": float(np.max(np.abs(formula_residual))) if formula_residual.size else None,
        "mean_signed_residual": float(np.mean(formula_residual)) if formula_residual.size else None,
        "low_likelihood_binary_flood_pixel_count": int(low_flood_formula_mask.sum()),
        "low_likelihood_binary_flood_expected_mean": {
            "minimum": float(np.min(low_flood_expected)) if low_flood_expected.size else None,
            "median": float(np.median(low_flood_expected)) if low_flood_expected.size else None,
            "mean": float(np.mean(low_flood_expected)) if low_flood_expected.size else None,
            "maximum": float(np.max(low_flood_expected)) if low_flood_expected.size else None,
            "within_one_value_count": int(np.count_nonzero(np.abs(low_flood_residual) <= 1.0)),
            "expected_mean_below_50_count": int(np.count_nonzero(low_flood_expected < 50)),
            "residual_mean_absolute": float(np.mean(np.abs(low_flood_residual))) if low_flood_residual.size else None,
            "residual_maximum_absolute": float(np.max(np.abs(low_flood_residual))) if low_flood_residual.size else None,
        },
        "low_likelihood_binary_flood_component_class_counts": low_flood_component_class_counts,
        "low_likelihood_candidate_overlap_expected_mean": {
            "pixel_count": int(low_flood_candidate_mask.sum()),
            "within_one_value_count": int(np.count_nonzero(
                np.abs(low_flood_candidate_observed - low_flood_candidate_expected) <= 1.0
            )),
            "expected_mean_below_50_count": int(np.count_nonzero(low_flood_candidate_expected < 50)),
            "median": float(np.median(low_flood_candidate_expected)) if low_flood_candidate_expected.size else None,
        },
        "low_likelihood_binary_flood_mismatch_examples": low_flood_mismatch_examples,
        "interpretation": (
            "The ensemble binary flood decision is based on majority voting, while its likelihood is "
            "the separate arithmetic mean of harmonized individual likelihood inputs. These outputs "
            "can disagree on confidence; a binary flood pixel with a mean below 50 is low-confidence "
            "positive support, not by itself evidence that the binary vote is wrong."
        ),
    }

    layers_valid = np.logical_and.reduce([
        algorithm_layers[name]["valid"].astype(bool) for name in required
    ])
    common_valid = (
        inside_aoi.astype(bool)
        & exclusion_valid.astype(bool)
        & reference_valid.astype(bool)
        & layers_valid
    )
    eligible = common_valid & (exclusion == 0) & (reference_water == 0)
    votes = np.zeros(ensemble_flood.shape, dtype=np.uint8)
    individual_counts = {}
    for name in required:
        flooded = algorithm_layers[name]["data"] == 1
        votes += flooded.astype(np.uint8)
        individual_counts[name] = int(np.count_nonzero(eligible & flooded))

    ensemble_positive = eligible & (ensemble_flood == 1)
    majority_positive = eligible & (votes >= 2)
    disagreement = eligible & ((ensemble_flood == 1) != (votes >= 2))
    low_likelihood_positive = ensemble_positive & (ensemble_likelihood < 50)
    high_likelihood_negative = eligible & (ensemble_flood == 0) & (ensemble_likelihood >= 50)

    def vote_histogram(mask: np.ndarray) -> dict[str, int]:
        return {
            str(vote_count): int(np.count_nonzero(mask & (votes == vote_count)))
            for vote_count in range(4)
        }

    low_likelihood_algorithm_values = {}
    low_likelihood_candidate_algorithm_values = {}
    low_likelihood_candidates = (
        low_likelihood_positive & candidate_mask.astype(bool)
        if candidate_mask is not None
        else np.zeros(ensemble_flood.shape, dtype=bool)
    )
    for name in required_likelihood:
        layer = algorithm_likelihood_layers[name]
        for target, mask in (
            (low_likelihood_algorithm_values, low_likelihood_positive),
            (low_likelihood_candidate_algorithm_values, low_likelihood_candidates),
        ):
            sample_mask = mask & layer["valid"].astype(bool)
            values = layer["data"][sample_mask]
            target[name] = {
                "valid_sample_count": int(values.size),
                "raw_layer_value_histogram": value_histogram(values),
                "minimum": int(np.min(values)) if values.size else None,
                "median": float(np.median(values)) if values.size else None,
                "mean": float(np.mean(values)) if values.size else None,
                "maximum": int(np.max(values)) if values.size else None,
            }

    result = {
        "source_algorithm_positive_pixel_counts": individual_counts,
        "common_valid_eligible_pixel_count": int(eligible.sum()),
        "algorithm_vote_histogram_on_eligible_pixels": vote_histogram(eligible),
        "ensemble_flood_pixels_with_majority_support": int((ensemble_positive & majority_positive).sum()),
        "ensemble_flood_pixels_without_majority_support": int((ensemble_positive & ~majority_positive).sum()),
        "ensemble_binary_vs_two_of_three_disagreement_count": int(disagreement.sum()),
        "ensemble_flood_pixels_with_likelihood_below_50": int(low_likelihood_positive.sum()),
        "low_likelihood_flood_algorithm_vote_histogram": vote_histogram(low_likelihood_positive),
        "raw_intermediate_likelihood_uncertainty_on_all_low_likelihood_flood_pixels": low_likelihood_algorithm_values,
        "raw_intermediate_likelihood_uncertainty_on_low_likelihood_candidate_overlap_pixels": low_likelihood_candidate_algorithm_values,
        "ensemble_nonflood_pixels_with_likelihood_at_least_50": int(high_likelihood_negative.sum()),
        "harmonized_likelihood_formula_check": formula_summary,
    }
    if advisory_flags is not None and advisory_valid is not None:
        if advisory_valid.shape != ensemble_flood.shape:
            raise ValueError("Advisory flags must share the GFM grid window.")
        low_with_flag = (
            low_likelihood_positive
            & advisory_valid.astype(bool)
            & (advisory_flags == 1)
        )
        result["low_likelihood_flood_pixels_with_advisory_flag"] = int(low_with_flag.sum())
        result["low_likelihood_flood_pixels_without_advisory_flag_or_flag_data"] = (
            int(low_likelihood_positive.sum()) - int(low_with_flag.sum())
        )
    return result


def summarize_candidate_overlap(
    candidate: np.ndarray,
    inside_aoi: np.ndarray,
    flood: np.ndarray,
    flood_valid: np.ndarray,
    exclusion: np.ndarray,
    exclusion_valid: np.ndarray,
    reference_water: np.ndarray,
    reference_valid: np.ndarray,
    likelihood: np.ndarray,
    likelihood_valid: np.ndarray,
    pixel_area_km2: float,
) -> dict:
    """Compute positive-only support on shared valid, non-excluded, non-reference-water cells."""
    arrays = (
        candidate, inside_aoi, flood, flood_valid, exclusion,
        exclusion_valid, reference_water, reference_valid,
        likelihood, likelihood_valid,
    )
    if len({array.shape for array in arrays}) != 1:
        raise ValueError("Candidate and GFM arrays must share one raster window.")
    if not math.isfinite(pixel_area_km2) or pixel_area_km2 <= 0:
        raise ValueError("Pixel area must be finite and positive.")

    candidate_aoi = candidate.astype(bool) & inside_aoi.astype(bool)
    common_valid = (
        flood_valid.astype(bool)
        & exclusion_valid.astype(bool)
        & reference_valid.astype(bool)
        & likelihood_valid.astype(bool)
        & inside_aoi.astype(bool)
    )
    candidate_valid = candidate_aoi & common_valid
    candidate_no_data = candidate_aoi & ~common_valid
    candidate_excluded = candidate_valid & (exclusion == 1)
    candidate_reference_water = candidate_valid & (reference_water > 0)
    eligible = candidate_valid & (exclusion == 0) & (reference_water == 0)
    positive = eligible & (flood == 1)
    negative = eligible & (flood == 0)

    def count(mask: np.ndarray) -> int:
        return int(np.count_nonzero(mask))

    candidate_count = count(candidate_aoi)
    candidate_valid_count = count(candidate_valid)
    eligible_count = count(eligible)
    positive_count = count(positive)
    negative_count = count(negative)

    positive_likelihood = likelihood[positive]
    likelihood_summary = None
    if positive_likelihood.size:
        likelihood_summary = {
            "count": int(positive_likelihood.size),
            "minimum": int(np.min(positive_likelihood)),
            "median": float(np.median(positive_likelihood)),
            "mean": float(np.mean(positive_likelihood)),
            "maximum": int(np.max(positive_likelihood)),
            "below_50_count": int(np.count_nonzero(positive_likelihood < 50)),
            "histogram": value_histogram(positive_likelihood),
        }

    return {
        "pixel_area_km2": pixel_area_km2,
        "rasterization_rule": "pixel center (all_touched=False) on the 20 m GFM grid",
        "candidate": {
            "rasterized_pixel_count_in_aoi": candidate_count,
            "rasterized_area_km2": candidate_count * pixel_area_km2,
            "candidate_pixels_with_common_valid_gfm_data": candidate_valid_count,
            "candidate_pixels_without_common_valid_gfm_data": count(candidate_no_data),
            "candidate_coverage_fraction": (
                candidate_valid_count / candidate_count if candidate_count else None
            ),
            "candidate_pixels_in_exclusion_mask": count(candidate_excluded),
            "candidate_pixels_in_reference_water_mask": count(candidate_reference_water),
            "eligible_candidate_pixel_count": eligible_count,
            "eligible_candidate_area_km2": eligible_count * pixel_area_km2,
        },
        "gfm_positive_support": {
            "overlap_pixel_count": positive_count,
            "overlap_area_km2": positive_count * pixel_area_km2,
            "fraction_of_eligible_candidate_pixels": (
                positive_count / eligible_count if eligible_count else None
            ),
            "fraction_of_all_rasterized_candidate_pixels": (
                positive_count / candidate_count if candidate_count else None
            ),
            "eligible_candidate_pixels_not_mapped_as_flood": negative_count,
            "positive_pixel_likelihood": likelihood_summary,
        },
        "denominator_warning": (
            "Positive-only cross-sensor support among candidate pixels with common valid GFM data "
            "outside GFM exclusion and permanent/seasonal reference-water masks. Missing, excluded "
            "and reference-water pixels are not counted as negative labels."
        ),
    }


def compare_published_candidates(item: dict, asset_urls: dict) -> dict:
    """Rasterize the published NISAR candidate polygons and inspect GFM overlap."""
    if not PATCHES_PATH.is_file():
        raise FileNotFoundError(f"Published NISAR candidate GeoJSON not found: {PATCHES_PATH}")
    with PATCHES_PATH.open(encoding="utf-8") as handle:
        document = json.load(handle)
    features = document.get("features") if isinstance(document, dict) else None
    if not isinstance(features, list) or not features:
        raise ValueError("Published NISAR candidate GeoJSON contains no features.")

    loaded = {}
    grid = None
    for name in (
        "ensemble_flood_extent",
        "ensemble_likelihood",
        "exclusion_mask",
        "reference_water_mask",
        "advisory_flags",
        "list_flood_extent",
        "dlr_flood_extent",
        "tuw_flood_extent",
        "list_likelihood",
        "dlr_likelihood",
        "tuw_likelihood",
    ):
        url = asset_urls.get(name)
        if not url:
            raise ValueError(f"Best GFM item is missing required asset: {name}")
        loaded[name] = read_asset_window(url, expected_grid=grid)
        grid = loaded[name]["grid"] if grid is None else grid

    flood = loaded["ensemble_flood_extent"]
    if any(
        loaded[name]["window"] != flood["window"]
        or loaded[name]["transform"] != flood["transform"]
        or loaded[name]["data"].shape != flood["data"].shape
        for name in loaded
    ):
        raise ValueError("GFM mask and flood windows are not spatially aligned.")

    geometries = []
    property_keys: set[str] = set()
    invalid_geometry_count = 0
    for feature in features:
        if not isinstance(feature, dict) or not isinstance(feature.get("geometry"), dict):
            invalid_geometry_count += 1
            continue
        geometry = feature["geometry"]
        if geometry.get("type") not in ("Polygon", "MultiPolygon"):
            invalid_geometry_count += 1
            continue
        projected = transform_geom("EPSG:4326", flood["grid"]["crs"], geometry)
        if projected:
            geometries.append((projected, 1))
            properties = feature.get("properties")
            if isinstance(properties, dict):
                property_keys.update(properties.keys())
    if not geometries:
        raise ValueError("No valid polygon geometries exist in the published candidate GeoJSON.")

    candidate = rasterize(
        geometries,
        out_shape=flood["data"].shape,
        transform=flood["transform"],
        fill=0,
        all_touched=False,
        dtype="uint8",
    ) == 1

    exclusion = loaded["exclusion_mask"]
    reference = loaded["reference_water_mask"]
    likelihood = loaded["ensemble_likelihood"]
    transform = flood["transform"]
    pixel_area_km2 = abs(
        transform.a * transform.e - transform.b * transform.d
    ) / 1_000_000

    comparison = summarize_candidate_overlap(
        candidate=candidate,
        inside_aoi=flood["inside_aoi"],
        flood=flood["data"],
        flood_valid=flood["valid"],
        exclusion=exclusion["data"],
        exclusion_valid=exclusion["valid"],
        reference_water=reference["data"],
        reference_valid=reference["valid"],
        likelihood=likelihood["data"],
        likelihood_valid=likelihood["valid"],
        pixel_area_km2=pixel_area_km2,
    )

    common_valid_aoi = (
        flood["valid"] & exclusion["valid"] & reference["valid"] & likelihood["valid"]
    )
    aoi_eligible = (
        common_valid_aoi
        & (exclusion["data"] == 0)
        & (reference["data"] == 0)
    )
    aoi_flooded = aoi_eligible & (flood["data"] == 1)
    algorithm_layers = {
        name: loaded[name]
        for name in ("list_flood_extent", "dlr_flood_extent", "tuw_flood_extent")
    }
    algorithm_likelihood_layers = {
        name: loaded[name]
        for name in ("list_likelihood", "dlr_likelihood", "tuw_likelihood")
    }
    algorithm_consistency = summarize_algorithm_consistency(
        ensemble_flood=flood["data"],
        ensemble_likelihood=likelihood["data"],
        exclusion=exclusion["data"],
        exclusion_valid=exclusion["valid"],
        reference_water=reference["data"],
        reference_valid=reference["valid"],
        inside_aoi=flood["inside_aoi"],
        algorithm_layers=algorithm_layers,
        algorithm_likelihood_layers=algorithm_likelihood_layers,
        candidate_mask=candidate,
        advisory_flags=loaded["advisory_flags"]["data"],
        advisory_valid=loaded["advisory_flags"]["valid"],
        ensemble_likelihood_valid=loaded["ensemble_likelihood"]["valid"],
    )
    return {
        "candidate_source": {
            "path": str(PATCHES_PATH.relative_to(ROOT)),
            "feature_count": len(features),
            "valid_polygon_feature_count": len(geometries),
            "skipped_feature_count": invalid_geometry_count,
            "property_keys": sorted(property_keys),
            "geometry_note": (
                "The comparison uses published display GeoJSON polygons, not the private native "
                "NISAR classification raster. Polygon simplification and rasterization can change "
                "edge-cell counts; treat the result as a spatial-support check."
            ),
        },
        "gfm_item": {
            "id": item["id"],
            "datetime": item["properties"].get("datetime"),
            "minutes_from_nisar_event": round((
                datetime.fromisoformat(item["properties"]["datetime"].replace("Z", "+00:00"))
                - datetime.fromisoformat(NISAR_EVENT_TIME.replace("Z", "+00:00"))
            ).total_seconds() / 60, 2),
            "gfm_nrt_version": flood["raster"]["tags"].get("gfm_nrt_version"),
            "crs": flood["grid"]["crs"],
            "pixel_size_m": [abs(transform.a), abs(transform.e)],
            "valid_aoi_pixel_count": int(flood["valid"].sum()),
        },
        "aoi_context": {
            "common_valid_pixel_count": int(common_valid_aoi.sum()),
            "eligible_non_excluded_non_reference_water_pixel_count": int(aoi_eligible.sum()),
            "gfm_flooded_pixel_count_after_masks": int(aoi_flooded.sum()),
            "gfm_flooded_area_km2_after_masks": int(aoi_flooded.sum()) * pixel_area_km2,
        },
        "ensemble_consistency": algorithm_consistency,
        "candidate_overlap": comparison,
        "interpretation_limits": [
            "This is positive-only overlap between an independent Sentinel-1 GFM algorithm product and published NISAR candidate polygons.",
            "It is not field validation, not a precision/recall/F1 score, and not proof that each NISAR candidate was flooded.",
            "The GFM scene is 23.75 minutes before the NISAR event time; sensors, wavelengths, acquisition geometries and processing algorithms differ.",
            "Only candidate cells with common valid data and outside GFM exclusion and reference-water masks enter the eligible denominator.",
            "Unobserved, excluded and permanent/seasonal reference-water cells are not treated as reference negatives.",
            "Published NISAR polygons are display geometries; the native classification raster was not included in the public release.",
        ],
    }


def build_report(items: list[dict]) -> dict:
    selected = select_event_items(items)
    if not selected:
        raise ValueError(f"No GFM STAC items were returned for {EVENT_DATE}.")
    cache: dict[str, dict] = {}
    acquisitions = []
    asset_urls_by_id: dict[str, dict] = {}

    for item in selected:
        item_id = item.get("id")
        properties = item.get("properties", {})
        timestamp = properties.get("datetime")
        if not isinstance(item_id, str) or not isinstance(timestamp, str):
            raise ValueError("A selected GFM item is missing its ID or datetime.")
        assets = item.get("assets")
        if not isinstance(assets, dict):
            raise ValueError(f"GFM item {item_id} has no assets dictionary.")

        grid = None
        results = {}
        asset_urls = {}
        for asset_name in ASSET_NAMES:
            asset = assets.get(asset_name)
            if not isinstance(asset, dict):
                results[asset_name] = {"status": "MISSING_ASSET"}
                continue
            url = _safe_asset_url(asset, item_id, asset_name)
            asset_urls[asset_name] = url
            if url not in cache:
                cache[url] = inspect_asset(url, expected_grid=grid)
            result = cache[url]
            grid = result["grid"] if grid is None else grid
            results[asset_name] = result

        event_time = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        nisar_time = datetime.fromisoformat(NISAR_EVENT_TIME.replace("Z", "+00:00"))
        acquisitions.append({
            "item_id": item_id,
            "datetime": timestamp,
            "minutes_from_nisar_event": round(
                (event_time - nisar_time).total_seconds() / 60, 2
            ),
            "source_properties": {
                key: properties.get(key)
                for key in ("constellation", "platform", "instruments", "gsd",
                            "proj:epsg", "proj:wkt2", "proj:shape", "proj:transform")
                if key in properties
            },
            "assets": results,
        })
        asset_urls_by_id[item_id] = asset_urls

    best_acquisition = max(
        acquisitions,
        key=lambda acquisition: acquisition["assets"]["ensemble_flood_extent"]
        .get("coverage", {}).get("valid_fraction_of_aoi", 0),
    )
    best_item = next(item for item in selected if item["id"] == best_acquisition["item_id"])
    candidate_comparison = compare_published_candidates(
        best_item, asset_urls_by_id[best_item["id"]]
    )

    return {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": "AOI_RASTER_WINDOWS_AND_CANDIDATE_OVERLAP_INSPECTED",
        "study": {
            "name": "Chokwe event study box",
            "bounds_wgs84": [32.93, -24.58, 33.03, -24.48],
            "boundary_type": "operator-selected rectangular analysis box",
            "boundary_is_authoritative": False,
        },
        "event": {
            "nisar_event_time_utc": NISAR_EVENT_TIME,
            "gfm_event_date_utc": EVENT_DATE,
            "gfm_item_count": len(acquisitions),
            "assets_inspected": list(ASSET_NAMES),
            "raster_pixels_read": True,
            "comparison_item_id": best_item["id"],
        },
        "acquisitions": acquisitions,
        "published_nisar_candidate_comparison": candidate_comparison,
        "interpretation_limits": [
            "Valid coverage and positive overlap do not establish classification accuracy or field truth.",
            "Unobserved, excluded and reference-water pixels remain separate and are not counted as negative labels.",
            "The GFM acquisition is an independent Sentinel-1 cross-sensor product; it is not a same-instrument replication of NISAR.",
        ],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args(argv)

    try:
        payload = discovery.build_search_payload(EVENT_DATE, EVENT_DATE)
        items = discovery.fetch_stac_items(payload)
        report = build_report(items)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(report, indent=2, allow_nan=False) + chr(10),
            encoding="utf-8",
        )
    except Exception as error:
        print(f"GFM pixel audit failed: {error}", file=sys.stderr)
        return 2

    print("Status:", report["status"])
    print("GFM event-date items:", report["event"]["gfm_item_count"])
    for acquisition in report["acquisitions"]:
        flood = acquisition["assets"].get("ensemble_flood_extent", {})
        coverage = flood.get("coverage", {})
        print(
            acquisition["datetime"],
            "AOI-valid fraction:",
            coverage.get("valid_fraction_of_aoi", "unavailable"),
            "flood value histogram:",
            coverage.get("value_histogram_on_valid_aoi_pixels", {}),
        )
    comparison = report["published_nisar_candidate_comparison"]["candidate_overlap"]
    print("NISAR published candidate overlap:")
    print(json.dumps(comparison, indent=2))
    print("Saved exact-AOI raster and candidate overlap audit:", args.output)
    print("No accuracy, precision, recall or F1 metrics were calculated.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
