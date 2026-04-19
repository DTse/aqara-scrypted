import sdk, {
  FFmpegInput,
  MediaObject,
  RequestMediaStreamOptions,
  ResponseMediaStreamOptions,
  ScryptedDeviceBase,
  ScryptedInterface,
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
 * Aqara G410 exposes three RTSP channels on port 8554.
 * Dimensions observed from one G410 unit; actual dimensions come from the
 * RTSP probe so these are informational only.
 */
const CHANNELS: Record<ChannelId, ChannelDescriptor> = {
  ch1: { id: "ch1", name: "Main (1600x1200)", width: 1600, height: 1200 },
  ch2: { id: "ch2", name: "Medium (1280x720)", width: 1280, height: 720 },
  ch3: { id: "ch3", name: "Sub (640x480)", width: 640, height: 480 },
};

export class AqaraCamera
  extends ScryptedDeviceBase
  implements VideoCamera, Settings
{
  constructor(nativeId: string) {
    super(nativeId);
    this.online = true;
  }

  release(): void {
    // no persistent resources
  }

  // ---------- Settings ----------

  async getSettings(): Promise<Setting[]> {
    const channelChoices = Object.keys(CHANNELS);
    const channelSummary = Object.values(CHANNELS)
      .map((c) => `${c.id} = ${c.name}`)
      .join(", ");

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
        description: "Default is 8554.",
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
        description: `Used for full-quality recording (HKSV/NVR). ${channelSummary}.`,
        value: this.resolveChannelId("mainChannel", "ch1"),
        choices: channelChoices,
      },
      {
        key: "subChannel",
        title: "Substream Channel",
        description: `Low-bitrate stream for thumbnails. ${channelSummary}.`,
        value: this.resolveChannelId("subChannel", "ch3"),
        choices: channelChoices,
      },
    ];
  }

  async putSetting(key: string, value: SettingValue): Promise<void> {
    if (key === "mainChannel" || key === "subChannel") {
      const id = String(value).trim() as ChannelId;
      if (!(id in CHANNELS)) {
        throw new Error(`Unknown channel: ${value}`);
      }
      this.storage.setItem(key, id);
    } else {
      this.storage.setItem(key, value === undefined ? "" : String(value));
    }
    this.onDeviceEvent(ScryptedInterface.Settings, undefined);
  }

  // ---------- VideoCamera ----------

  async getVideoStreamOptions(): Promise<ResponseMediaStreamOptions[]> {
    const mainId = this.resolveChannelId("mainChannel", "ch1");
    const subId = this.resolveChannelId("subChannel", "ch3");

    const toOption = (id: ChannelId): ResponseMediaStreamOptions => {
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
      };
    };

    const options: ResponseMediaStreamOptions[] = [toOption(mainId)];
    if (subId !== mainId) {
      options.push(toOption(subId));
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
      inputArguments: ["-rtsp_transport", "tcp", "-i", url],
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
