import assert from "node:assert/strict";
import test from "node:test";
import {
  validateCosignImageSignatures,
  validateSupplyChain,
  validateWorkflowActionPins,
  validateWorkflowBuildArgs,
  validateWorkflowCheckoutCredentials,
} from "./check-supply-chain.mjs";

test("requires checkout credentials to be discarded after read-only checkout", () => {
  assert.deepEqual(
    validateWorkflowCheckoutCredentials(
      "steps:\n  - uses: actions/checkout@08eba0b27e820071cde6df949e0beb9ba4906955\n",
    ),
    ["checkout must set persist-credentials: false"],
  );
  assert.deepEqual(
    validateWorkflowCheckoutCredentials(
      "steps:\n  - uses: actions/checkout@08eba0b27e820071cde6df949e0beb9ba4906955\n    with:\n      ref: abc\n      persist-credentials: false\n",
    ),
    [],
  );
});

test("accepts annotated multiline Cosign target and recovery signatures", () => {
  const workflow = `
IMAGE: ghcr.io/pendevtsp-star/giro-mesa-v2-\${{ matrix.service }}@\${{ steps.build.outputs.digest }}
run: >-
  cosign sign --yes
  -a role=target
  -a sourceCommit=\${{ github.event.workflow_run.head_sha }}
  -a authorizedByMain=\${{ github.event.workflow_run.head_sha }}
  "$IMAGE"
IMAGE: ghcr.io/pendevtsp-star/giro-mesa-v2-\${{ matrix.service }}@\${{ steps.build.outputs.digest }}
run: >-
  cosign sign --yes -a role=recovery
  -a sourceCommit=\${{ needs.authorize-recovery.outputs.recovery_sha }}
  -a authorizedByMain=\${{ github.event.workflow_run.head_sha }} "$IMAGE"
`;
  assert.deepEqual(validateCosignImageSignatures(workflow), []);
  assert.deepEqual(validateCosignImageSignatures(workflow.replace("-a role=recovery", "")), [
    "recovery image signature must bind role, source commit and main authorization",
  ]);
  const combined = workflow
    .replace('"$IMAGE"\nIMAGE:', "-a role=recovery\nIMAGE:")
    .replace(/run: >-\n {2}cosign sign --yes -a role=recovery[\s\S]*?"\$IMAGE"/, "");
  assert.match(
    validateCosignImageSignatures(combined).join("\n"),
    /exactly one target and one recovery signature/,
  );
});

test("supply-chain configuration meets the local release contract", () => {
  assert.deepEqual(validateSupplyChain(), []);
});

test("rejects movable GitHub Action references", () => {
  assert.deepEqual(validateWorkflowActionPins("steps:\n  - uses: actions/checkout@v4\n"), [
    "workflow action must use an immutable commit SHA: actions/checkout@v4",
  ]);
  assert.deepEqual(
    validateWorkflowActionPins(
      "steps:\n  - uses: actions/checkout@08eba0b27e820071cde6df949e0beb9ba4906955 # v4.3.0\n",
    ),
    [],
  );
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

const buildArgStyles = [
  { name: "inline", value: (argument) => argument },
  { name: "literal", value: (argument) => `|\n            ${argument}` },
  { name: "folded", value: (argument) => `>\n            ${argument}` },
  { name: "chomping", value: (argument) => `|-\n            ${argument}` },
  { name: "sequence", value: (argument) => `\n            - ${argument}` },
];

for (const style of buildArgStyles) {
  test(`rejects a GitHub secret in ${style.name} Docker build args`, () => {
    const errors = validateWorkflowBuildArgs(
      dockerBuildWorkflow(style.value("PUBLIC_VALUE=" + "${{" + " secrets.API_TOKEN }}")),
    );

    assert.deepEqual(errors, ["workflow Docker build args must not carry GitHub secrets"]);
  });

  test(`rejects a sensitive name in ${style.name} Docker build args`, () => {
    const errors = validateWorkflowBuildArgs(
      dockerBuildWorkflow(style.value("API_TOKEN=forbidden")),
    );

    assert.deepEqual(errors, ["workflow Docker build args must not use sensitive argument names"]);
  });
}
