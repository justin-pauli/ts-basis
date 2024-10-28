#!/usr/bin/env node
import { execSync } from 'child_process'

try {
    execSync(
        `\
  rm -rf index.js*
  rm -rf *.js
  rm -rf *.map
  find . -name '*.ts._instr.*' -delete
  find src -name '*.map' -delete
  find src -name '*.js' -delete
  find tests -name '*.js' -delete
  find tests -name '*.map' -delete
  find nodejs -name '*.js' -delete
  find nodejs -name '*.map' -delete
`,
        { stdio: [] },
    )
} catch (e) {}

console.log(`js and map files cleaned in ${process.cwd()}`)
