# Naming Conventions

Use descriptive names that help other developers understand your intent. Avoid placeholder names like `x`, `y`, `foo`, `bar`.

```ts
// ❌
const x = '192.168.1.50';
const foo = () => {};
export default Bar;

// ✅
const cameraHost = '192.168.1.50';
const buildRtspUrl = () => {};
export default AqaraCamera;
```

## Rules by entity

| Entity | Convention | Examples |
|--------|-----------|---------|
| Classes | PascalCase | `AqaraCamera`, `IntercomSession`, `AqaraProvider` |
| Interfaces | PascalCase | `ChannelDescriptor`, `RtspUrlParts` |
| Type aliases | PascalCase | `ChannelId`, `ParsedPacket` |
| Functions | camelCase | `buildRtspUrl`, `parseRingEndpoint`, `resolveChannel` |
| Methods | camelCase | `triggerDoorbell`, `getDoorbellToken` |
| Local variables | camelCase | `webhookUrl`, `sessionTs` |
| Module-level constants | UPPER_SNAKE | `TYPE_START_VOICE`, `DOORBELL_RESET_MS`, `MAGIC`, `CONTROL_PORT` |
| Enum-like literal unions | UPPER_SNAKE for values, PascalCase for the type | `type ChannelId = 'ch1' \| 'ch2' \| 'ch3'` |
| Private class fields | camelCase, no underscore/hash prefix | `doorbellResetTimer`, `intercomSession` |
| File names | kebab-case | `intercom-session.ts`, `camera.ts`, `helpers.ts` |
| Test files | `<source>.test.ts` co-located | `protocol.test.ts`, `helpers.test.ts` |

## Additional rules

- **Boolean variables and predicates start with `is`, `has`, `should`, `can`, or a verb ending in `ed`.** `isDoorbell`, `hasToken`, `shouldRetry`, `stopped`, `acked`.
- **Async functions get verb names** (`start`, `stop`, `publish`, `fetch`), not noun names.
- **Constants matching protocol fields preserve the upstream casing** where meaningful. `TYPE_START_VOICE` mirrors the upstream `LmLocalPacket` reference C code; don't rename to `startVoiceType`.
- **Don't encode types in names.** `cameraList` is better than `cameraArray`. `token` is better than `tokenString`.
- **Test case names start with the subject, then a colon, then the case description** in plain English — no "Should" prefix (project convention differs from drewberry here):
  ```ts
  test('parseRingEndpoint: rejects token with invalid chars', () => { ... });
  ```
