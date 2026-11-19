import { defineRailway, github, preserve, project, service } from "railway/iac";

/**
 * The room server for "build grid together" (scripts/together-server.ts).
 * The web app itself deploys on Vercel; only this server lives on Railway.
 *
 * Nothing here is read on a push by itself: after changing this file, run
 * `railway config plan`, read the plan, then `railway config apply`.
 */
export default defineRailway(() => {
  const together = service("waifu100-together", {
    // Deploy on every push to main once the GitHub check has passed.
    source: github("salmondev/waifu100", { branch: "main", checkSuites: true }),
    build: {
      buildEnvironment: "V3",
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile.together",
      // Only what the room server imports (scripts/together-server.ts pulls
      // in src/lib/** through the "@/" alias). A web-only change does not
      // redeploy it, and the rooms held in memory survive.
      watchPatterns: [
        "scripts/**",
        "src/lib/**",
        "package.json",
        "bun.lock",
        "tsconfig.json",
        "Dockerfile.together",
      ],
    },
    deploy: {
      startCommand: "bun scripts/together-server.ts",
      healthcheckPath: "/",
      restartPolicyType: "ON_FAILURE",
    },
    replicas: { iad: 1 },
    // The value stays on Railway. It is never written into this file.
    env: { TOGETHER_ADMIN_TOKEN: preserve() },
  });

  return project("waifu100-together", {
    resources: [together],
  });
});
