
import {
  Cl,
  cvToValue,
  signMessageHashRsv,
} from "@stacks/transactions";
import { beforeEach, describe, expect, it } from "vitest";
import { cvToHex } from "@stacks/transactions";

// `simnet` is a "simulation network" - a local, testing Stacks node for running our tests
const accounts = simnet.getAccounts();

// The identifiers of these wallets can be found in the `settings/Devnet.toml` config file
const sender = accounts.get("wallet_1")!;
const recipient = accounts.get("wallet_2")!;
const randomUser = accounts.get("wallet_3")!;

describe("test token streaming contract", () => {
  beforeEach(() => {
    const result = simnet.callPublicFn(
      "stream",
      "stream-to",
      [
        Cl.principal(recipient),
        Cl.uint(5),
        Cl.tuple({ "start-block": Cl.uint(0), "stop-block": Cl.uint(5) }),
        Cl.uint(1),
      ],
      sender
    );

    expect(result.events[0].event).toBe("stx_transfer_event");
    expect(result.events[0].data.amount).toBe("5");
    expect(result.events[0].data.sender).toBe(sender);
  });

  it("ensures contract is initialized properly and stream is created", () => {
    const latestStreamId = simnet.getDataVar("stream", "latest-stream-id");
    expect(latestStreamId).toBeUint(1);

    const createdStream = simnet.getMapEntry("stream", "streams", Cl.uint(0));
    expect(createdStream).toBeSome(
      Cl.tuple({
        sender: Cl.principal(sender),
        recipient: Cl.principal(recipient),
        balance: Cl.uint(5),
        "withdrawn-balance": Cl.uint(0),
        "payment-per-block": Cl.uint(1),
        timeframe: Cl.tuple({
          "start-block": Cl.uint(0),
          "stop-block": Cl.uint(5),
        }),
      })
    );
  });

  it("ensures stream can be refueled", () => {
    const result = simnet.callPublicFn(
      "stream",
      "refuel",
      [Cl.uint(0), Cl.uint(5)],
      sender
    );

    expect(result.events[0].event).toBe("stx_transfer_event");
    expect(result.events[0].data.amount).toBe("5");
    expect(result.events[0].data.sender).toBe(sender);

    const createdStream = simnet.getMapEntry("stream", "streams", Cl.uint(0));
    expect(createdStream).toBeSome(
      Cl.tuple({
        sender: Cl.principal(sender),
        recipient: Cl.principal(recipient),
        balance: Cl.uint(10),
        "withdrawn-balance": Cl.uint(0),
        "payment-per-block": Cl.uint(1),
        timeframe: Cl.tuple({
          "start-block": Cl.uint(0),
          "stop-block": Cl.uint(5),
        }),
      })
    );
  });

  it("ensures stream cannot be refueled by random address", () => {
    const result = simnet.callPublicFn(
      "stream",
      "refuel",
      [Cl.uint(0), Cl.uint(5)],
      randomUser
    );

    expect(result.result).toBeErr(Cl.uint(0));
  });

  it("ensures recipient can withdraw tokens over time", () => {
    const withdraw = simnet.callPublicFn(
      "stream",
      "withdraw",
      [Cl.uint(0)],
      recipient
    );

    expect(withdraw.events[0].event).toBe("stx_transfer_event");
    expect(withdraw.events[0].data.amount).toBe("4");
    expect(withdraw.events[0].data.recipient).toBe(recipient);
  });

  it("ensures non-recipient cannot withdraw tokens from stream", () => {
    const withdraw = simnet.callPublicFn(
      "stream",
      "withdraw",
      [Cl.uint(0)],
      randomUser
    );

    expect(withdraw.result).toBeErr(Cl.uint(0));
  });

  it("ensures sender can withdraw excess tokens", () => {
    simnet.callPublicFn("stream", "refuel", [Cl.uint(0), Cl.uint(5)], sender);
    simnet.mineEmptyBlock();
    simnet.mineEmptyBlock();
    simnet.callPublicFn("stream", "withdraw", [Cl.uint(0)], recipient);

    const refund = simnet.callPublicFn(
      "stream",
      "refund",
      [Cl.uint(0)],
      sender
    );

    expect(refund.events[0].event).toBe("stx_transfer_event");
    expect(refund.events[0].data.amount).toBe("5");
    expect(refund.events[0].data.recipient).toBe(sender);
  });

  it("signature verification can be done on stream hashes", () => {
    const hashedStream0 = simnet.callReadOnlyFn(
      "stream",
      "hash-stream",
      [
        Cl.uint(0),
        Cl.uint(0),
        Cl.tuple({ "start-block": Cl.uint(1), "stop-block": Cl.uint(2) }),
      ],
      sender
    );

    // Get the hash as a hex string and extract just the hash data
    const hashAsHex = cvToHex(hashedStream0.result);
    const actualHashHex = hashAsHex.slice(-64);

    const signature = signMessageHashRsv({
      messageHash: actualHashHex,
      privateKey: "7287ba251d44a4d3fd9276c88ce34c5c52a038955511cccaf77e61068649c17801",
    });

    const verifySignature = simnet.callReadOnlyFn(
      "stream",
      "validate-signature",
      [
        Cl.bufferFromHex(actualHashHex),
        Cl.bufferFromHex(signature),
        Cl.principal(sender),
      ],
      sender
    );

    expect(cvToValue(verifySignature.result)).toBe(true);
  });

  it("ensures timeframe and payment per block can be modified with consent of both parties", () => {
    const hashedStream0 = simnet.callReadOnlyFn(
      "stream",
      "hash-stream",
      [
        Cl.uint(0),
        Cl.uint(1),
        Cl.tuple({ "start-block": Cl.uint(0), "stop-block": Cl.uint(4) }),
      ],
      sender
    );

    // Extract just the hash data (last 64 characters)
    const hashAsHex = cvToHex(hashedStream0.result);
    const actualHashHex = hashAsHex.slice(-64);
    console.log("Actual hash:", actualHashHex);

    const senderSignature = signMessageHashRsv({
      messageHash: actualHashHex,
      privateKey: "7287ba251d44a4d3fd9276c88ce34c5c52a038955511cccaf77e61068649c17801",
    });

    // console.log("Signature data:", senderSignature.data);

    simnet.callPublicFn(
      "stream",
      "update-details",
      [
        Cl.uint(0),
        Cl.uint(1),
        Cl.tuple({ "start-block": Cl.uint(0), "stop-block": Cl.uint(4) }),
        Cl.principal(sender),
        Cl.bufferFromHex(senderSignature),
      ],
      recipient
    );

    const updatedStream = simnet.getMapEntry("stream", "streams", Cl.uint(0));
    expect(updatedStream).toBeSome(
      Cl.tuple({
        sender: Cl.principal(sender),
        recipient: Cl.principal(recipient),
        balance: Cl.uint(5),
        "withdrawn-balance": Cl.uint(0),
        "payment-per-block": Cl.uint(1),
        timeframe: Cl.tuple({
          "start-block": Cl.uint(0),
          "stop-block": Cl.uint(4),
        }),
      })
    );
  });
});