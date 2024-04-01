import "reflect-metadata";

// import { startBot } from "./bot";
import { AppDataSource } from "./db/dataSource";
import polkadotActions from "./dripper/polkadot/PolkadotActions";
import AvailApi from "./dripper/polkadot/polkadotApi";
import { startServer } from "./server";

(async () => {
  await AppDataSource.initialize();
  // Waiting for bot to start first.
  // Thus, listening to port on the server side can be treated as "ready" signal.
  // await startBot();
  await polkadotActions.isReady;
  const polkadotApi = await AvailApi();
  await polkadotApi.isReady;
  // void runtimeRestarter({
  //   metadata: {
  //     getMetadataVersion: async () => (await polkadotApi.rpc.state.getMetadata()).version.toString(),
  //     onMetadataChange: () => process.exit(0),
  //   },
  //   runtime: {
  //     getRuntimeVersionHash: async () => (await polkadotApi.rpc.state.getRuntimeVersion()).hash.toString(),
  //     onRuntimeChange: () => process.exit(0),
  //   },
  //   log: logger.info,
  // });
  // disApi(polkadotApi);
  startServer();
})().catch((e) => {
  console.error("Start failed:", e);
  process.exit(1);
});
