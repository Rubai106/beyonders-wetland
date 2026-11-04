"""Static safety tests for the cloud-only Baniachong comparison workflow."""
import subprocess
import unittest
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "agriculture-candidate-inspection.yml"


class AgricultureCandidateWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = WORKFLOW.read_text(encoding="utf-8")
        cls.workflow = yaml.load(cls.source, Loader=yaml.BaseLoader)
        cls.job = cls.workflow["jobs"]["inspect-both-candidates"]
        cls.steps = cls.job["steps"]

    def test_workflow_is_manual_and_master_only(self):
        triggers = self.workflow["on"]
        self.assertEqual(set(triggers), {"workflow_dispatch"})
        self.assertEqual(self.job["if"], "github.ref_name == 'master'")
        checkout = self.steps[0]
        self.assertEqual(checkout["with"]["ref"], "master")
        self.assertEqual(checkout["with"]["persist-credentials"], "false")

    def test_candidate_ids_match_the_reviewed_preflight_defaults(self):
        inputs = self.workflow["on"]["workflow_dispatch"]["inputs"]
        self.assertEqual(inputs["series_id_141"]["default"], "c5f219dd7bbc")
        self.assertEqual(inputs["series_id_069"]["default"], "540e079403d5")
        self.assertIn("SERIES_141", self.source)
        self.assertIn("SERIES_069", self.source)
        self.assertIn("re.fullmatch(r\"[a-f0-9]{12}\"", self.source)

    def test_earthdata_token_is_scoped_only_to_the_download_step(self):
        token_steps = [
            step["name"] for step in self.steps
            if "EARTHDATA_TOKEN" in step.get("env", {})
        ]
        self.assertEqual(token_steps, ["Download both exact candidate series from Earthdata"])
        self.assertNotIn("GITHUB_TOKEN", self.job.get("env", {}))
        self.assertEqual(self.workflow["permissions"]["contents"], "read")

    def test_workflow_never_runs_analysis_or_publication(self):
        run_scripts = "\n".join(step.get("run", "") for step in self.steps)
        self.assertIn("agriculture_sme2.py search", run_scripts)
        self.assertIn("agriculture_sme2.py download", run_scripts)
        self.assertIn("agriculture_sme2_inspect.py", run_scripts)
        self.assertNotRegex(run_scripts, r"agriculture_sme2\.py\s+(?:analyze|publish)")
        self.assertNotRegex(run_scripts, r"(?m)^\\s*(?:git\\s+add|cp|mv)\\b.*public/agriculture/current")
        self.assertIn("No winner is selected automatically", run_scripts)

    def test_every_shell_block_passes_bash_syntax_check(self):
        checked = 0
        for step in self.steps:
            script = step.get("run")
            if not script:
                continue
            checked += 1
            result = subprocess.run(
                ["bash", "-n"], input=script, text=True, capture_output=True, check=False,
            )
            self.assertEqual(
                result.returncode, 0,
                f"Invalid shell syntax in {step.get('name')}: {result.stderr}",
            )
        self.assertGreater(checked, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
