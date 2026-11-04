"""Static security contract tests for the GitHub-hosted Agriculture worker."""
from pathlib import Path
import subprocess
import unittest

import yaml


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "agriculture-cloud.yml"


class AgricultureCloudWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = WORKFLOW.read_text(encoding="utf-8")

    def test_untrusted_series_id_is_passed_through_environment(self):
        self.assertIn("SERIES_ID: ${{ steps.request.outputs.series_id }}", self.source)
        self.assertNotIn('SERIES_ID="${{ steps.request.outputs.series_id }}"', self.source)
        self.assertIn('[[ ! "$SERIES_ID" =~ ^[a-f0-9]{12}$ ]]', self.source)

    def test_untrusted_fallback_boolean_is_passed_through_environment(self):
        self.assertIn(
            'if has("allow_missing_imerg") then .allow_missing_imerg else true end',
            self.source,
        )
        self.assertNotIn(".allow_missing_imerg // true", self.source)
        self.assertIn("ALLOW_MISSING_IMERG: ${{ steps.request.outputs.allow_missing_imerg }}", self.source)
        self.assertNotIn(
            'ALLOW_MISSING_IMERG="${{ steps.request.outputs.allow_missing_imerg }}"',
            self.source,
        )
        self.assertIn(
            '[ "$ALLOW_MISSING" != "true" ] && [ "$ALLOW_MISSING" != "false" ]',
            self.source,
        )

    def test_jq_preserves_explicit_false_for_missing_imerg(self):
        expression = 'if has("allow_missing_imerg") then .allow_missing_imerg else true end'
        for payload, expected in (
            ('{"allow_missing_imerg": false}', "false"),
            ('{"allow_missing_imerg": true}', "true"),
            ("{}", "true"),
        ):
            result = subprocess.run(
                ["jq", "-r", expression],
                input=payload,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), expected)

    def test_request_values_are_validated_before_github_outputs(self):
        self.assertIn("Dates must use the exact YYYY-MM-DD format.", self.source)
        self.assertIn("AOI must not exceed 2 degrees in either dimension.", self.source)
        self.assertIn("exceeds 366 days", self.source)
        self.assertIn("printf 'series_id=%s\\n' \"$SERIES_ID\"", self.source)
        self.assertIn("printf 'allow_missing_imerg=%s\\n' \"$ALLOW_MISSING\"", self.source)

    def test_every_cloud_workflow_shell_block_passes_bash_syntax_check(self):
        workflow = yaml.load(self.source, Loader=yaml.BaseLoader)
        jobs = workflow.get("jobs", {})
        self.assertTrue(jobs, "workflow must define at least one job")
        checked = 0
        for job_name, job in jobs.items():
            for step in job.get("steps", []):
                script = step.get("run")
                if not script:
                    continue
                checked += 1
                result = subprocess.run(
                    ["bash", "-n"],
                    input=script,
                    text=True,
                    capture_output=True,
                    check=False,
                )
                self.assertEqual(
                    result.returncode,
                    0,
                    f"Invalid shell syntax in {job_name} / {step.get('name')}: {result.stderr}",
                )
        self.assertGreater(checked, 0, "workflow must contain shell steps to validate")

    def test_credentials_are_scoped_to_only_the_steps_that_need_them(self):
        workflow = yaml.load(self.source, Loader=yaml.BaseLoader)
        job = workflow["jobs"]["process-and-publish"]
        self.assertNotIn("EARTHDATA_TOKEN", job.get("env", {}))

        checkout = job["steps"][0]
        self.assertEqual(checkout["with"].get("persist-credentials"), "false")

        earthdata_steps = {
            step["name"]
            for step in job["steps"]
            if "EARTHDATA_TOKEN" in step.get("env", {})
        }
        self.assertEqual(
            earthdata_steps,
            {
                "Validate secure Earthdata configuration",
                "Download the exact selected SME2 series",
                "Attach NASA GPM IMERG Final rainfall context",
            },
        )

        github_token_steps = {
            step["name"]
            for step in job["steps"]
            if "GITHUB_TOKEN" in step.get("env", {})
        }
        self.assertEqual(github_token_steps, {"Commit the publication package to master"})
        commit_step = next(
            step for step in job["steps"]
            if step["name"] == "Commit the publication package to master"
        )
        self.assertEqual(commit_step["env"]["GITHUB_TOKEN"], "${{ github.token }}")

    def test_optional_dynamic_world_artifact_is_pinned_validated_and_fail_closed(self):
        workflow = yaml.load(self.source, Loader=yaml.BaseLoader)
        self.assertIn("actions", workflow["permissions"])
        self.assertEqual(workflow["permissions"]["actions"], "read")
        dispatch_inputs = workflow["on"]["workflow_dispatch"]["inputs"]
        self.assertEqual(dispatch_inputs["dynamic_world_run_id"]["required"], "false")
        self.assertIn("DYNAMIC_WORLD_RUN_ID: ${{ steps.request.outputs.dynamic_world_run_id }}", self.source)
        self.assertIn('[[ ! "$DYNAMIC_WORLD_RUN_ID" =~ ^[0-9]{6,20}$ ]]', self.source)

        job = workflow["jobs"]["process-and-publish"]
        steps = job["steps"]
        names = [step.get("name") for step in steps]
        resolve_index = names.index("Resolve and verify optional Dynamic World workflow run")
        download_index = names.index("Download the selected Dynamic World evidence artifact")
        validate_index = names.index("Validate Dynamic World evidence against the selected SME2 series")
        analyze_index = names.index("Analyze real SME2 observations")
        self.assertLess(resolve_index, download_index)
        self.assertLess(download_index, validate_index)
        self.assertLess(validate_index, analyze_index)

        resolve = steps[resolve_index]
        self.assertIn(".workflow_id == $workflow_id", resolve["run"])
        self.assertIn('.head_branch == "master"', resolve["run"])
        self.assertIn('.status == "completed"', resolve["run"])
        self.assertIn('.conclusion == "success"', resolve["run"])
        self.assertIn('.repository.full_name == $repo', resolve["run"])
        self.assertIn('.head_repository.full_name == $repo', resolve["run"])

        download = steps[download_index]
        self.assertEqual(download["if"], "steps.crop-mask.outputs.enabled == 'true'")
        self.assertEqual(download["with"]["run-id"], "${{ steps.request.outputs.dynamic_world_run_id }}")
        self.assertIn("agriculture-dynamic-world-crop-evidence-", download["with"]["name"])
        self.assertEqual(download["with"]["repository"], "${{ github.repository }}")
        self.assertEqual(download["with"]["github-token"], "${{ github.token }}")

        validate = steps[validate_index]
        self.assertEqual(validate["if"], "steps.crop-mask.outputs.enabled == 'true'")
        self.assertIn("validate_dynamic_world_crop_artifact.py", validate["run"])
        analyze = steps[analyze_index]
        self.assertIn("CROP_MASK_ENABLED", analyze["env"])
        self.assertIn("--crop-mask", analyze["run"])
        self.assertIn("--crop-probability-threshold", analyze["run"])

    def test_worker_keeps_earthdata_secret_out_of_inputs(self):
        self.assertIn("EARTHDATA_TOKEN: ${{ secrets.EARTH_DATA }}", self.source)
        self.assertNotIn("INPUT_EARTHDATA_TOKEN", self.source)
        self.assertNotIn("EARTHDATA_TOKEN: ${{ inputs.", self.source)


if __name__ == "__main__":
    unittest.main(verbosity=2)
