import assert from "node:assert/strict";
import test from "node:test";
import { validateSupplyChain, validateWorkflowBuildArgs } from "./check-supply-chain.mjs";

test("supply-chain configuration meets the local release contract", () => {
  assert.deepEqual(validateSupplyChain(), []);
});

const dockerBuildWorkflow = (buildArgs) => `
jobs:
  publish:
    steps:
      - uses: docker/login-action@v3
        with:
          password: \${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          build-args: ${buildArgs}
      - run: echo done
`;

test("rejects GitHub secrets in inline Docker build args", () => {
  const errors = validateWorkflowBuildArgs(
    dockerBuildWorkflow("PUBLIC_VALUE=" + "${{" + " secrets.API_TOKEN }}"),
  );

  assert.deepEqual(errors, ["workflow Docker build args must not carry GitHub secrets"]);
});

test("rejects sensitive Docker build-arg names in folded, chomping, and list forms", () => {
  const errors = validateWorkflowBuildArgs(
    dockerBuildWorkflow(`>-
            PUBLIC_VALUE=safe
            - API_TOKEN=forbidden
            - PASSWORD=also-forbidden`),
  );

  assert.deepEqual(errors, ["workflow Docker build args must not use sensitive argument names"]);
});
