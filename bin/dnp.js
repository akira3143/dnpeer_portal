#!/usr/bin/env node
import { handleCliCommand } from '../server/cliCommands.js';

handleCliCommand(process.argv.slice(2));

