import "@polkadot/api-augment";
import { Keyring } from "@polkadot/keyring";
import { KeyringPair } from "@polkadot/keyring/types";
import { waitReady } from "@polkadot/wasm-crypto";
import BN from "bn.js";

import { config } from "../../config";
import { isDripSuccessResponse } from "../../guards";
import { logger } from "../../logger";
import { getNetworkData } from "../../networkData";
import { DripResponse } from "../../types";
import AvailApi, { disApi } from "./polkadotApi";
import { formatAmount } from "./utils";

const mnemonic = config.Get("FAUCET_ACCOUNT_MNEMONIC");
const balancePollIntervalMs = 60000; // 1 minute

const networkName = config.Get("NETWORK");
const networkData = getNetworkData(networkName);

const rpcTimeout = (service: string) => {
  const timeout = 30000;
  return setTimeout(() => {
    // log an error in console and in prometheus if the timeout is reached
    logger.error(`⭕ Oops, ${service} took more than ${timeout}ms to answer`);
  }, timeout);
};

export class PolkadotActions {
  account: KeyringPair | undefined;
  #faucetBalance: bigint | undefined;
  isReady: Promise<void>;

  constructor() {
    logger.info("🚰 Plip plop - Creating the faucets's account");
    let makeReady: () => void;

    this.isReady = new Promise((resolve) => {
      makeReady = resolve;
    });

    try {
      const keyring = new Keyring({ type: "sr25519" });

      waitReady().then(() => {
        this.account = keyring.addFromMnemonic(mnemonic);

        // We do want the following to just start and run
        // TODO: Adding a subscription would be better but the server supports on http for now
        const updateFaucetBalance = (log = false) =>
          this.updateFaucetBalance().then(() => {
            if (log) logger.info("Fetched faucet balance 💰");
            setTimeout(updateFaucetBalance, balancePollIntervalMs);
          });
        updateFaucetBalance(true).then(makeReady);
      });
    } catch (error) {
      logger.error(error);
    }
  }

  /**
   * This function checks the current balance and updates the `faucetBalance` property.
   */
  private async updateFaucetBalance() {
    if (!this.account?.address) {
      logger.warn("Account address wasn't initialized yet");
      return;
    }

    try {
      const polkadotApi = await AvailApi();
      await polkadotApi.isReady;
      const { data: balance } = await polkadotApi.query.system.account(this.account.address);
      this.#faucetBalance = balance.free.toBigInt();
      disApi(polkadotApi);
    } catch (e) {
      logger.error(e);
    }
  }

  public getFaucetBalance(): bigint | undefined {
    return this.#faucetBalance;
  }

  public async getAccountBalance(address: string): Promise<number> {
    const polkadotApi = await AvailApi();
    await polkadotApi.isReady;
    const { data } = await polkadotApi.query.system.account(address);

    const { free: balanceFree } = data;
    disApi(polkadotApi);
    return balanceFree
      .toBn()
      .div(new BN(10).pow(new BN(networkData.decimals)))
      .toNumber();
  }

  public async isAccountOverBalanceCap(address: string): Promise<boolean> {
    return (await this.getAccountBalance(address)) > networkData.balanceCap;
  }

  async sendTokens(address: string, amount: bigint): Promise<DripResponse> {
    let dripTimeout: ReturnType<typeof rpcTimeout> | null = null;
    let result: DripResponse;
    const faucetBalance = this.getFaucetBalance();

    try {
      if (!this.account) throw new Error("account not ready");

      if (typeof faucetBalance !== "undefined" && amount >= faucetBalance) {
        const formattedAmount = formatAmount(amount);
        const formattedBalance = formatAmount(faucetBalance);

        throw new Error(
          `Can't send ${formattedAmount} ${networkData.currency}s, as balance is only ${formattedBalance} ${networkData.currency}s.`,
        );
      }

      // start a counter and log a timeout error if we didn't get an answer in time
      dripTimeout = rpcTimeout("drip");
      logger.info("💸 sending tokens");
      const polkadotApi = await AvailApi();
      const options = { app_id: 0, nonce: -1 };
      await polkadotApi.isReady;
      const account = this.account;
      const transfer = polkadotApi.tx.balances.transferKeepAlive(address, amount);
      // eslint-disable-next-line unused-imports/no-unused-vars-ts
      const hashPromise = new Promise<string>((resolve, reject) => {
        transfer.signAndSend(account, options, ({ status, txHash }) => {
          if (status.isInBlock) {
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            console.log(`Transaction included at blockHash ${status.asInBlock}`);
            // Assuming status.asInBlock is the transaction hash
            resolve(txHash.toHex());
          }
        });
      });

      const hash = await hashPromise;
      result = { hash: hash };
      console.log(result);
      disApi(polkadotApi);
      // }
    } catch (e) {
      result = { error: (e as Error).message || "An error occured when sending tokens" };
      logger.error("⭕ An error occured when sending tokens", e);
    }

    // we got and answer reset the timeout
    if (dripTimeout) clearTimeout(dripTimeout);

    if (isDripSuccessResponse(result)) {
      await this.updateFaucetBalance().then(() => logger.info("Refreshed the faucet balance 💰"));
    }

    return result;
  }

  async getBalance(): Promise<string> {
    try {
      if (!this.account) {
        throw new Error("account not ready");
      }

      logger.info("💰 checking faucet balance");

      // start a counter and log a timeout error if we didn't get an answer in time
      const balanceTimeout = rpcTimeout("balance");
      const polkadotApi = await AvailApi();
      await polkadotApi.isReady;
      const { data: balances } = await polkadotApi.query.system.account(this.account.address);

      // we got and answer reset the timeout
      clearTimeout(balanceTimeout);
      disApi(polkadotApi);
      return balances.free.toString();
    } catch (e) {
      logger.error("⭕ An error occured when querying the balance", e);
      return "0";
    }
  }
}

export default new PolkadotActions();
