/** Public adapter surface. Normalized contracts are exported by protocol. */
export { type OpenAICompatibleOptions, OpenAICompatibleProvider } from "./adapter.js";
export {
  type FakeAttempt,
  type FakeDelta,
  FakeProvider,
  type FakeScript,
  type FakeTurn,
  type FakeUsage,
} from "./fake.js";
export { type RecordingFetch, recordingFetch } from "./recorder.js";
