import sdk, {
  FFmpegInput,
  MediaObject,
  MotionSensor,
  BinarySensor,
  RequestMediaStreamOptions,
  ResponseMediaStreamOptions,
  ScryptedDeviceBase,
  ScryptedMimeTypes,
  Setting,
  SettingValue,
  Settings,
  VideoCamera,
} from "@scrypted/sdk";

const { mediaManager } = sdk;

type ChannelId = "ch1" | "ch2" | "ch3";

interface ChannelDescriptor {
  id: ChannelId;
  name: string;
  width: number;
  height: number;
}

/**
 * Aqara G410 advertises three RTSP channels:
 *   ch1 = 2K (2304x1728)
 *   ch2 = 1080p
 *   ch3 = 640x480 (substream)
 */
const CHANNELS: Record<ChannelId, ChannelDescriptor> = {
  ch1: { id: "ch1", name: "Main (2K)", width: 2304, height: 1728 },
  ch2: { id: "ch2", name: "Medium (1080p)", width: 1920, height: 1080 },
  ch3: { id: "ch3", name: "Sub (480p)", width: 640, height: 480 },
};

export class AqaraCamera
  extends ScryptedDeviceBase
  implements VideoCamera, MotionSensor, BinarySensor, Settings
{
  constructor(nativeId: string) {
    super(nativeId);
    this.online = true;
  }

  release(): void {
    // no persistent resources yet; placeholder for Phase 2 (event listeners)
  }

  // ---------- Settings ----------

  async getSettings(): Promise<Setting[]> {
    const channelChoices = Object.values(CHANNELS).map(
      (c) => `${c.id} — ${c.name}`,
    );

    return [
      {
        key: "host",
        title: "IP Address or Hostname",
        value: this.storage.getItem("host") || "",
      },
      {
        key: "rtspPort",
        title: "RTSP Port",
        value: this.storage.getItem("rtspPort") || "8554",
        description: "Default is 8554. Rarely needs to change.",
      },
      {
        key: "username",
        title: "RTSP Username",
        value: this.storage.getItem("username") || "",
      },
      {
        key: "password",
        title: "RTSP Password",
        type: "password",
        value: this.storage.getItem("password") || "",
      },
      {
        key: "mainChannel",
        title: "Main Stream Channel",
        description:
          "Used for full-quality recording (HKSV/NVR) and large-tile viewing.",
        value: this.storage.getItem("mainChannel") || "ch1",
        choices: channelChoices,
      },
      {
        key: "subChannel",
        title: "Substream Channel",
        description: "Low-bitrate stream used for thumbnails and small tiles.",
        value: this.storage.getItem("subChannel") || "ch3",
        choices: channelChoices,
      },
      {
        key: "isDoorbell",
        title: "Is a Doorbell",
        type: "boolean",
        value: this.storage.getItem("isDoorbell") === "true",
        readonly: true,
        description:
          "Set when this device was added. Recreate the device to change.",
      },
    ];
  }

  async putSetting(key: string, value: SettingValue): Promise<void> {
    // Channel choice strings come back as "ch1 — Main (2K)" — extract the id.
    if (key === "mainChannel" || key === "subChannel") {
      const raw = String(value);
      const id = raw.split(/\s|—/)[0].trim();
      if (!(id in CHANNELS)) {
        throw new Error(`Unknown channel: ${raw}`);
      }
      this.storage.setItem(key, id);
      return;
    }
    this.storage.setItem(key, value === undefined ? "" : String(value));
  }

  // ---------- VideoCamera ----------

  async getVideoStreamOptions(): Promise<ResponseMediaStreamOptions[]> {
    const mainId = this.resolveChannelId("mainChannel", "ch1");
    const subId = this.resolveChannelId("subChannel", "ch3");

    const toOption = (
      id: ChannelId,
      overrides: Partial<ResponseMediaStreamOptions>,
    ): ResponseMediaStreamOptions => {
      const c = CHANNELS[id];
      return {
        id,
        name: c.name,
        container: "rtsp",
        video: { codec: "h264", width: c.width, height: c.height },
        audio: { codec: "aac" },
        source: "local",
        tool: "scrypted",
        userConfigurable: false,
        ...overrides,
      };
    };

    const options: ResponseMediaStreamOptions[] = [toOption(mainId, {})];
    if (subId !== mainId) {
      options.push(toOption(subId, {}));
    }
    return options;
  }

  async getVideoStream(
    options?: RequestMediaStreamOptions,
  ): Promise<MediaObject> {
    const requestedId = (options?.id as ChannelId) || undefined;
    const mainId = this.resolveChannelId("mainChannel", "ch1");
    const channelId =
      requestedId && requestedId in CHANNELS ? requestedId : mainId;

    const url = this.buildRtspUrl(channelId);
    const channel = CHANNELS[channelId];

    const ffmpegInput: FFmpegInput = {
      url,
      container: "rtsp",
      inputArguments: [
        "-rtsp_transport",
        "tcp",
        "-i",
        url,
      ],
      mediaStreamOptions: {
        id: channelId,
        name: channel.name,
        container: "rtsp",
        video: {
          codec: "h264",
          width: channel.width,
          height: channel.height,
        },
        audio: { codec: "aac" },
        source: "local",
        tool: "scrypted",
      },
    };

    return mediaManager.createMediaObject(
      Buffer.from(JSON.stringify(ffmpegInput)),
      ScryptedMimeTypes.FFmpegInput,
    );
  }

  // ---------- Helpers for Phase 2 event wiring ----------

  /** Called by the Phase 2 event listener when a motion start event arrives. */
  triggerMotion(durationMs = 15_000): void {
    this.motionDetected = true;
    setTimeout(() => {
      this.motionDetected = false;
    }, durationMs);
  }

  /** Called by the Phase 2 event listener on a doorbell press. */
  triggerDoorbell(durationMs = 10_000): void {
    this.binaryState = true;
    setTimeout(() => {
      this.binaryState = false;
    }, durationMs);
  }

  // ---------- Internal ----------

  private resolveChannelId(key: string, fallback: ChannelId): ChannelId {
    const raw = (this.storage.getItem(key) || fallback) as ChannelId;
    return raw in CHANNELS ? raw : fallback;
  }

  private buildRtspUrl(channelId: ChannelId): string {
    const host = this.storage.getItem("host") || "";
    const port = this.storage.getItem("rtspPort") || "8554";
    const user = encodeURIComponent(this.storage.getItem("username") || "");
    const pass = encodeURIComponent(this.storage.getItem("password") || "");
    if (!host) {
      throw new Error(
        "Camera host is not configured. Open the camera settings and set the IP Address.",
      );
    }
    const auth = user ? `${user}:${pass}@` : "";
    return `rtsp://${auth}${host}:${port}/${channelId}`;
  }
}
