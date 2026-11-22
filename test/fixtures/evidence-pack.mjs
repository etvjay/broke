// Builds a small Kane-style evidence pack for tests: a zip with stored entries.
// Token-shaped values are assembled at run time, so no such literal sits in the repo.
import { crc32 } from "node:zlib";

export const TOKEN = ["ghp", "_", "A".repeat(36)].join("");

export const PACK_ENTRIES = [
  { name: "run.yaml", data: "run: open the start page\nstatus: passed\n" },
  { name: "tests/open-page/result.yaml", data: "owner: owner@example.com\n" },
  { name: "tests/open-page/logs/tui.log", data: "Profile jay opened /home/ubuntu/kane/app/server.mjs\n" },
  { name: "tests/open-page/logs/network.log", data: "GET http://203.0.113.42:3100/ Cookie: sid=abc123\n" },
  { name: "tests/open-page/logs/token.log", data: `build token ${TOKEN}\n` },
  { name: "tests/open-page/steps/1-0-1/screenshot.jpg", data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]) }
];

// DOS date for 22 Nov 2026, so unzip reports a real date.
const DOS_DATE = ((2026 - 1980) << 9) | (11 << 5) | 22;

export function zipEntries(entries) {
  const parts = [];
  const directory = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const body = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const nameBytes = Buffer.from(name);
    const crc = crc32(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    parts.push(local, nameBytes, body);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(DOS_DATE, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(body.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    directory.push(entry, nameBytes);

    offset += local.length + nameBytes.length + body.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, central, end]);
}
