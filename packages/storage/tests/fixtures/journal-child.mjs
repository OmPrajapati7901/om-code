// Real process boundary for lock ownership and meaningful SIGKILL points.
import { JournalWriter } from "../../dist/index.js";

const options = JSON.parse(process.argv[2]);
const stage = process.argv[3];
const writer = await JournalWriter.open({
  ...options,
  hooks: {
    stage(point) {
      if (point === stage) process.kill(process.pid, "SIGKILL");
    },
  },
});
if (stage?.startsWith("append-"))
  await writer.append(
    { kind: "user_message", schemaVersion: 1, text: "committed" },
    { by: "user" },
  );
if (stage === "hold") {
  process.stdout.write(`ready ${process.pid}\n`);
  setInterval(() => {}, 1000);
} else {
  await writer.close();
}
