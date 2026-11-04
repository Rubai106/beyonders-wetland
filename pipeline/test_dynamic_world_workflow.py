"""Static safety tests for the cloud-only Dynamic World acquisition workflow."""
from pathlib import Path
import subprocess
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "agriculture-dynamic-world.yml"


class DynamicWorldWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = WORKFLOW.read_text(encoding="utf-8")
        cls.workflow = yaml.load(cls.source, Loader=yaml.BaseLoader)
        cls.job = cls.workflow["jobs"]["acquire-independent-crop-evidence"]
        cls.steps = cls.job["steps"]

    def test_workflow_is_manual_master_only_and_read_only(self):
        self.assertEqual(set(self.workflow["on"]), {"workflow_dispatch"})
        self.assertIn("github.ref_name == 'master'", self.job["if"])
        self.assertEqual(self.workflow["permissions"]["contents"], "read")
        self.assertEqual(self.steps[0]["with"]["ref"], "master")
        self.assertEqual(self.steps[0]["with"]["persist-credentials"], "false")

    def test_earth_engine_credentials_are_scoped_to_acquisition_step(self):
        names = [
            step["name"] for step in self.steps
            if "EARTH_ENGINE_SERVICE_ACCOUNT_JSON" in step.get("env", {})
            or "EARTH_ENGINE_PROJECT" in step.get("env", {})
        ]
        self.assertEqual(names, ["Acquire and validate Dynamic World crop probability"])
        self.assertNotIn("EARTH_ENGINE_SERVICE_ACCOUNT_JSON", self.job.get("env", {}))
        self.assertNotIn("GITHUB_TOKEN", self.job.get("env", {}))

    def test_workflow_does_not_run_analysis_rainfall_or_publication(self):
        scripts = "\n".join(step.get("run", "") for step in self.steps)
        self.assertIn("download_dynamic_world_crop_mask.py", scripts)
        self.assertNotRegex(scripts, r"agriculture_sme2\.py\s+(?:analyze|rainfall|publish)")
        self.assertNotIn("public/agriculture/current", scripts)
        self.assertIn("dynamic-world-valid-observation-count.tif", self.source)
        self.assertIn("retention-days: 30", self.source)

    def test_all_shell_blocks_pass_bash_syntax_check(self):
        checked = 0
        for step in self.steps:
            script = step.get("run")
            if not script:
                continue
            checked += 1
            result = subprocess.run(
                ["bash", "-n"], input=script, text=True, capture_output=True, check=False,
            )
            self.assertEqual(result.returncode, 0, f"Invalid shell syntax in {step.get('name')}: {result.stderr}")
        self.assertGreater(checked, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
