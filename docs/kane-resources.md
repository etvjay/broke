# Kane CLI resources

Repos, packages, and projects around Kane CLI, for testers and hackers. I checked each repo on GitHub on 24 Nov 2026. The descriptions summarize each repo's own description. I did not run or review the community projects.

## Official repos

| Repo | What it gives you | License | Last push |
|---|---|---|---|
| [LambdaTest/kane-cli](https://github.com/LambdaTest/kane-cli) | The Kane CLI. Agent skills in `.claude/skills/kane-cli` and `.agents/skills/kane-cli`, plus a GitHub Action and Kiro steering in `integrations/`. | Apache-2.0 | 2026-11-24 |
| [LambdaTest/kane-cli-run](https://github.com/LambdaTest/kane-cli-run) | GitHub Action that runs plain-English browser tests in CI. It gives a pass or fail verdict, an evidence pack, and a PR comment. | Apache-2.0 | 2026-10-29 |
| [LambdaTest/kane-claude-plugin](https://github.com/LambdaTest/kane-claude-plugin) | `kane-qe` plugin for Claude Code. It shows Kane runs live and nudges you to test what Claude changed. | MIT | 2026-10-26 |
| [LambdaTest/homebrew-kane](https://github.com/LambdaTest/homebrew-kane) | Homebrew tap for installing the Kane CLI. | None | 2026-11-17 |
| [LambdaTest/agent-skills](https://github.com/LambdaTest/agent-skills) | Skills for AI agents on TestMu AI. | MIT | 2026-11-17 |
| [LambdaTest/rook](https://github.com/LambdaTest/rook) | Tests how AI agents behave across workflows, tools, and actions, and catches failures before they ship. | Apache-2.0 | 2026-11-20 |
| [LambdaTest/ai-native-quality-validation-sample](https://github.com/LambdaTest/ai-native-quality-validation-sample) | Airbnb-clone demo app for the TestMu AI Cloud GitHub App (KaneAI). It shows PR quality validation with preview deployments. | MIT | 2026-10-27 |
| [LambdaTest/documentation](https://github.com/LambdaTest/documentation) | TestMu AI docs source. It includes the `docs/kane-cli-*.md` pages, such as the quickstart, CLI reference, CI/CD, and coding agent guides. | None | 2026-11-24 |

## Package and pages

- npm: [@testmuai/kane-cli-skill](https://www.npmjs.com/package/@testmuai/kane-cli-skill), version 0.1.7. It generates and runs end-to-end tests from requirements on desktop web, Android, and iOS. Source: [LambdaTest/kane-cli](https://github.com/LambdaTest/kane-cli).
- [Kane CLI page](https://www.testmuai.com/kane-cli)
- [Kane CLI Cookbook](https://www.testmuai.com/kane-cli-cookbook)

## Hackathon winners

From the [winners post](https://www.testmuai.com/blog/kane-cli-hackathon-winners):

- Gold: [demo.studio](https://github.com/SamFelix03/demo.studio), narrated website demo videos driven by Kane CLI. [Demo video](https://www.youtube.com/watch?v=NlvFnU8O-b8)
- Silver: [adventures-with-kane](https://github.com/18Abhinav07/adventures-with-kane) by Abhinav Pangaria, also called GuardianKane. [Demo video](https://youtu.be/TfVm0yNzBJE)
- Bronze: KANE vs. ABLE by Christine Lall. The post links no repo, and a GitHub search did not find one.

## Showcased on the Kane CLI page

| Repo | About | License | Last push |
|---|---|---|---|
| [PhiBao/signed-off](https://github.com/PhiBao/signed-off) | Turns a signed freelance scope into a client page that shows each promise checked in a real browser. Archived. | MIT | 2026-08-29 |
| [Enoch208/lens](https://github.com/Enoch208/lens) | Semantic regression detection for AI-written software. Kane CLI checks browser behavior before and after an agent's change. | MIT | 2026-08-22 |
| [sneg55/mutiny](https://github.com/sneg55/mutiny) | Falsification gate for agent-built apps, built on Kane CLI. | None | 2026-08-19 |
| [mrnetwork0001/Pactora](https://github.com/mrnetwork0001/Pactora) | Multi-role escrow marketplace. Kane CLI catches a cross-party bug, and Claude Code patches it. | Other | 2026-08-31 |
| [Jiyungi/playtest-studio](https://github.com/Jiyungi/playtest-studio) | Browser game-building studio where Kane CLI is the automated playtester. | MIT | 2026-05-30 |

The sixth showcased project, adventures-with-kane, is listed under the winners.

## Other community projects

| Repo | About | License | Last push |
|---|---|---|---|
| [qinheyi/kane-loop](https://github.com/qinheyi/kane-loop) | Closes the loop between a coding agent and Kane CLI: browser verify, failure report, agent patch, and re-verify until green. | MIT | 2026-11-20 |
| [cryptocloud786/kane-loop](https://github.com/cryptocloud786/kane-loop) | SplitSure bill splitter. Its coding agent cannot ship until Kane CLI says green. | MIT | 2026-10-31 |
| [Josephjbassey/kane-intake](https://github.com/Josephjbassey/kane-intake) | Document intake agent with closed-loop Kane CLI verification. Built for the TestMu AI Hackathon 2026. | None | 2026-11-15 |
| [zkasuran/plumb](https://github.com/zkasuran/plumb) | Design rules checked by a real browser inside the agent's loop. Built on Kane CLI. | Apache-2.0 | 2026-11-13 |
| [cassim1030/kane-checkout-gatekeeper](https://github.com/cassim1030/kane-checkout-gatekeeper) | Tiny shop that refuses to ship until Kane CLI signs off. Built for the Kane CLI Online Hackathon. | None | 2026-11-19 |
| [tomcode1000/zelkaro](https://github.com/tomcode1000/zelkaro) | Kane CLI finds a data leak between users in an AI-built app. The coding agent fixes it, and Kane verifies the fix. | MIT | 2026-11-24 |
| [chosenvincent1/KaneCLI-Hackathon](https://github.com/chosenvincent1/KaneCLI-Hackathon) | Developer tool that verifies AI-generated code changes with Kane CLI and feeds failures back to the agent. | None | 2026-08-21 |
| [zachbuilds26/kloop](https://github.com/zachbuilds26/kloop) | Live playground for an agent and Kane loop. Kane CLI hackathon entry. | None | 2026-08-31 |
| [coral-fox-12/flowdeck-kane-studio](https://github.com/coral-fox-12/flowdeck-kane-studio) | Flow studio to write, organize, and export Kane CLI browser test flows. | None | 2026-11-17 |
| [dunoil/greenlight-kane-loop](https://github.com/dunoil/greenlight-kane-loop) | InvoiceForge invoicing app, verified by Kane CLI in a closed agent loop. | None | 2026-11-24 |
| [ExJoyz/deploy-gate](https://github.com/ExJoyz/deploy-gate) | Launch board that refuses to deploy until Kane CLI approves. Kane CLI hackathon entry. | MIT | 2026-11-19 |
| [igoreduardoai/payoutfit](https://github.com/igoreduardoai/payoutfit) | Kane CLI Online Hackathon 2026 entry. | MIT | 2026-11-23 |
| [t1dem/proofed](https://github.com/t1dem/proofed) | Watches every PR in a real browser with Kane CLI and fixes what breaks. | MIT | 2026-11-23 |
| [Alvinagustus/bugboing](https://github.com/Alvinagustus/bugboing) | Fail, fix, and rerun CLI. It reports green only after a Kane run passes. | MIT | 2026-11-24 |
| [antareada/word-halo](https://github.com/antareada/word-halo) | Typography experiment built with OpenAI Codex and verified with Kane CLI, for the Kane CLI Online Hackathon. | None | 2026-08-29 |
| [lambdapro/agentic-stlc-kane-hyperexecute](https://github.com/lambdapro/agentic-stlc-kane-hyperexecute) | End-to-end agentic software testing lifecycle with Kane AI CLI, HyperExecute, and Selenium Python. | MIT | 2026-06-04 |
| [mukilanmuthuvalathan/flowpatch](https://github.com/mukilanmuthuvalathan/flowpatch) | Hackathon project for Kane CLI. Short description only. | None | 2026-11-20 |
| [yao23/aeg-kane-room-hackday](https://github.com/yao23/aeg-kane-room-hackday) | Kane Room Hack Day edition: community troubleshooting and reusable experience, verified with Kane CLI. | None | 2026-10-24 |
| [tuguScript/seefood](https://github.com/tuguScript/seefood) | "Not Hotdog, reborn," built with AWS Kiro and verified with Kane CLI. From the Kane CLI Hack Day in San Francisco, May 30, 2026. | None | 2026-05-30 |
| [bhawana001/kane-cli-tests](https://github.com/bhawana001/kane-cli-tests) | Browser automation tests powered by Kane CLI. | None | 2026-04-27 |
| [naveentestmuai-source/N_KaneCLI_Assurance](https://github.com/naveentestmuai-source/N_KaneCLI_Assurance) | No description. | None | 2026-09-12 |
| [prashant-sharmaaa/kaneCLIassurance](https://github.com/prashant-sharmaaa/kaneCLIassurance) | No description. | None | 2026-10-13 |
| [LorenzoSdV/KaneCLIHackathon](https://github.com/LorenzoSdV/KaneCLIHackathon) | No description. | None | 2026-10-25 |
| [siddhant573/Kane-CLI-Workshop](https://github.com/siddhant573/Kane-CLI-Workshop) | Sample repo for the Kane CLI workshop at TestMu conf 2026. | MIT | 2026-08-20 |
| [mso-docs/Kane-CLI-Hackathon-2026](https://github.com/mso-docs/Kane-CLI-Hackathon-2026) | Kane CLI hackathon entry. | None | 2026-08-21 |
| [siddhant573/kane-cli-pr-tracker](https://github.com/siddhant573/kane-cli-pr-tracker) | PR status tracker dashboard for Kane CLI. | None | 2026-09-09 |
| [sreeforgithub/kaneai-sample-app](https://github.com/sreeforgithub/kaneai-sample-app) | Test app for KaneAI. | None | 2026-05-07 |

## Notes

- License "None" means the repo has no license file. Ask the author before you reuse its code.
- Repos change. Check a repo before you depend on it.
