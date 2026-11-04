"""Static security contract tests for the GitHub-hosted Agriculture worker."""
from pathlib import Path
import unittest


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

    def test_request_values_are_validated_before_github_outputs(self):
        self.assertIn("Dates must use the exact YYYY-MM-DD format.", self.source)
        self.assertIn("AOI must not exceed 2 degrees in either dimension.", self.source)
        self.assertIn("exceeds 366 days", self.source)
        self.assertIn("printf 'series_id=%s\\n' \"$SERIES_ID\"", self.source)
        self.assertIn("printf 'allow_missing_imerg=%s\\n' \"$ALLOW_MISSING\"", self.source)

    def test_worker_keeps_earthdata_secret_out_of_inputs(self):
        self.assertIn("EARTHDATA_TOKEN: ${{ secrets.EARTH_DATA }}", self.source)
        self.assertNotIn("INPUT_EARTHDATA_TOKEN", self.source)
        self.assertNotIn("EARTHDATA_TOKEN: ${{ inputs.", self.source)


if __name__ == "__main__":
    unittest.main(verbosity=2)
