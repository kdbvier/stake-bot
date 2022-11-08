import {
  StargateClient,
  setupGovExtension,
  QueryClient,
} from "@cosmjs/stargate";
import { HttpClient, Tendermint34Client } from "@cosmjs/tendermint-rpc";
import * as fs from "fs";
import { toBase64, toUtf8 } from "@cosmjs/encoding";
import axios from "axios";
import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { GasPrice } from "@cosmjs/stargate";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { history } from "./history.js";
import moment from "moment";
import { exec } from "child_process";
import { XMLHttpRequest } from "xmlhttprequest";
// import { UTF8 } from 'utf-8';

import pkg from "utf8";
const { encode, decode } = pkg;

// const utf8 = import('utf8');

const RPC = "https://rpc-juno.itastakers.com:443";

const config = {
  endpoint: "https://rpc-juno.itastakers.com:443",
  bech32prefix: "juno",
  feeDenom: "ujuno",
  gasPrice: GasPrice.fromString("0.01ujuno"),
  mnemonic:
    "tomorrow magic deal control flight quote left saddle type domain rifle aware",
};

async function setup() {
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(config.mnemonic, {
    prefix: config.bech32prefix,
  });
  const { address } = (await wallet.getAccounts())[0];
  const options = {
    prefix: config.bech32prefix,
    gasPrice: config.gasPrice,
  };
  const client = await SigningCosmWasmClient.connectWithSigner(
    config.endpoint,
    wallet,
    options
  );

  // now ensure there is a balance
  console.log(`Querying balance of ${address}`);
  const { denom, amount } = await client.getBalance(address, config.feeDenom);
  console.log(`Got ${amount} ${denom}`);
  if (!amount || amount === "0") {
    console.log("Please add tokens to your account before uploading");
  }

  return { address, client };
}

const contractAddr =
  "juno1lqqv9qt5ghlpzsy0wsk02zh0qdansm8fkh9rjz97ke4zvh78254qx80jj6";
const rewardtokenAddr =
  "juno1y9rf7ql6ffwkv02hsgd4yruz23pn4w97p75e2slsnkm0mnamhzysvqnxaq";

const step = 86400;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const { address, client } = await setup();

function decodeString(key) {
  let decoded = "";
  let arr = [];
  while (key.length >= 2) {
    arr.push(parseInt(key.substring(0, 2), 16));
    decoded = decoded + String.fromCharCode(parseInt(key.substring(0, 2), 16));
    key = key.substring(2, key.length);
  }
  // console.log(decoded)
  return decoded;
}

function log(logstr) {
  logstr = moment(new Date()).format("YYYY-MM-DD hh:mm:ss") + " : " + logstr;
  fs.appendFileSync(
    `/achilles/external-log/external-${moment(new Date()).format(
      "YYYY-MM-DD"
    )}.log`,
    logstr + "\n"
  );
  console.log("logstr", logstr);
}

async function main() {
  let daily_reward = 136986301000 / 2;
  let current_amount = await client.queryContractSmart(rewardtokenAddr, {
    balance: { address: `${address}` },
  });
  console.log(current_amount.balance);
  if (current_amount.balance < daily_reward) {
    console.log("Insufficient amount");
    return;
  }

  let flag = false;
  let first = false;
  if (history.length > 0) {
    let last = history[history.length - 1].date;
    if (
      Math.floor(last / step) < Math.floor(new Date().getTime() / 1000 / step)
    )
      flag = true;
  } else {
    flag = true;
    first = true;
  }
  console.log("before history push: ", history);
  history.push({
    date: Math.round(new Date().getTime() / 1000),
  });
  while (history.length > 60) history.shift();
  try {
    fs.writeFileSync(
      `history.js`,
      "export const history = " + JSON.stringify(history, null, 4)
    );
  } catch (err) {
    console.error(err);
  }
  if (!flag) return;

  var tmClient = await Tendermint34Client.connect(RPC);

  //Get the DAO Staker List
  // junod q wasm cs all <STAKING_CONTRACT_ADDRESS> --node https://rpc-juno.itastakers.com:443 --output json > tmp.json
  var xmlHttp = new XMLHttpRequest();
  xmlHttp.open(
    "GET",
    "https://lcd-juno.cosmostation.io/wasm/contract/" + contractAddr + "/state",
    false
  ); // false for synchronous request
  xmlHttp.send(null);
  let daostakers = JSON.parse(xmlHttp.responseText).result;

  exec("rm -rf .node-xmlhttprequest-sync-*");
  let dao_staker_list = [];

  let dao_staker_amount = 0;
  let staker = "";
  let amount = "";
  for (let i = 0; i < daostakers.length; i++) {
    let decoded = decodeString(daostakers[i].key);
    let temp = decoded.split("staked_balances");

    if (temp.length > 1) {
      staker = temp[1];

      amount = Buffer.from(daostakers[i].value, "base64").toString();
      amount = amount.substring(1, amount.length - 1);
      dao_staker_list[dao_staker_list.length] = { address: staker, amount };
      dao_staker_amount += parseInt(amount);
    }
  }
  console.log("total staker amount : " + dao_staker_amount);

  let msglist = [];

  let total_reward_amount = 0;
  for (let i = 0; i < dao_staker_list.length; i++) {
    let reward_amount = Math.floor(
      (daily_reward * parseInt(dao_staker_list[i].amount)) / dao_staker_amount
    );
    if (reward_amount == 0) continue;
    total_reward_amount += reward_amount;
    let jsonmsg = {
      transfer: {
        recipient: dao_staker_list[i].address,
        amount: `${reward_amount}`,
      },
    };
    let msg = {
      typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
      value: {
        sender: address,
        contract: rewardtokenAddr,
        msg: toUtf8(JSON.stringify(jsonmsg)),
        funds: [],
      },
    };

    msglist.push(msg);

    if (msglist.length >= 20 || i == dao_staker_list.length - 1) {
      let defaultFee = {
        amount: [],
        gas: `${100000 * msglist.length}`,
      };
      log(
        "sending " +
          total_reward_amount +
          " BLOCK to " +
          msglist.length +
          " stakers start"
      );
      for (let k = 0; k < 20; k++) {
        try {
          let result = await client?.signAndBroadcast(
            address,
            msglist,
            defaultFee
          );
          log(
            "sent " +
              total_reward_amount +
              " BLOCK to " +
              msglist.length +
              " stakers"
          );
          break;
        } catch (error) {
          log(error.toString());
          await sleep(20000);
          continue;
        }
      }

      msglist = [];
      total_reward_amount = 0;
      await sleep(10000);
    }
  }
}

while (true) {
  log("======================================");
  try {
    await main();
  } catch (error) {
    log(error);
  }
  log("====>    Waiting 10min");
  await sleep(600000);
}
