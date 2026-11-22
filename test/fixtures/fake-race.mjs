#!/usr/bin/env node
// Test double for race.mjs. It records how the Stop hook started it, then exits.
import { writeFileSync } from "node:fs";

writeFileSync(process.env.FAKE_RACE_MARKER, `${JSON.stringify({ args: process.argv.slice(2) })}\n`);
