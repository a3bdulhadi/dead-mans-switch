const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("DeadMansSwitch - Boundaries, Latch & EIP-712 Check-Ins (Days 3-8)", function () {
  const STAGE = {
    SAFE: 0,
    ALERT: 1,
    RELEASED: 2,
  };

  const ONE_MINUTE = 60;
  const ONE_HOUR = 60 * ONE_MINUTE;
  const ONE_DAY = 24 * ONE_HOUR;

  async function deploySwitchFixture() {
    const [owner, otherAccount] = await ethers.getSigners();
    const DeadMansSwitch = await ethers.getContractFactory("DeadMansSwitch");
    const dms = await DeadMansSwitch.deploy();
    await dms.waitForDeployment();
    return { dms, owner, otherAccount };
  }

  // Helper to build and sign an EIP-712 CheckIn payload
  async function signCheckIn(dms, signer, { nonce, deadline, duress = false }) {
    const network = await ethers.provider.getNetwork();
    const domain = {
      name: "DeadMansSwitch",
      version: "1",
      chainId: network.chainId,
      verifyingContract: await dms.getAddress(),
    };

    const types = {
      CheckIn: [
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "duress", type: "bool" },
      ],
    };

    const value = { nonce, deadline, duress };
    const signature = await signer.signTypedData(domain, types, value);
    const { v, r, s } = ethers.Signature.from(signature);
    return { nonce, deadline, duress, v, r, s };
  }

  // --- Week 1: Stage Boundaries ---
  it("starts in SAFE stage immediately after deployment", async function () {
    const { dms } = await deploySwitchFixture();
    expect(await dms.getStage()).to.equal(STAGE.SAFE);
  });

  it("stays in SAFE at 1d 23h 59m (1 minute before ALERT threshold)", async function () {
    const { dms } = await deploySwitchFixture();
    await time.increase(1 * ONE_DAY + 23 * ONE_HOUR + 59 * ONE_MINUTE);
    expect(await dms.getStage()).to.equal(STAGE.SAFE);
  });

  it("transitions to ALERT at exactly 2 days", async function () {
    const { dms } = await deploySwitchFixture();
    await time.increase(2 * ONE_DAY);
    expect(await dms.getStage()).to.equal(STAGE.ALERT);
  });

  it("stays in ALERT at 4d 23h 59m (1 minute before RELEASED threshold)", async function () {
    const { dms } = await deploySwitchFixture();
    await time.increase(4 * ONE_DAY + 23 * ONE_HOUR + 59 * ONE_MINUTE);
    expect(await dms.getStage()).to.equal(STAGE.ALERT);
  });

  it("transitions to RELEASED at exactly 5 days", async function () {
    const { dms } = await deploySwitchFixture();
    await time.increase(5 * ONE_DAY);
    expect(await dms.getStage()).to.equal(STAGE.RELEASED);
  });

  it("resets back to SAFE when owner submits a valid EIP-712 signed check-in during ALERT", async function () {
    const { dms, owner, otherAccount } = await deploySwitchFixture();
    await time.increase(3 * ONE_DAY);
    expect(await dms.getStage()).to.equal(STAGE.ALERT);

    const latestTime = await time.latest();
    const signed = await signCheckIn(dms, owner, {
      nonce: 0,
      deadline: latestTime + ONE_HOUR,
      duress: false,
    });

    // Even a third-party relayer (otherAccount) can submit the owner's valid signature
    await dms
      .connect(otherAccount)
      .checkInWithSignature(signed.nonce, signed.deadline, signed.duress, signed.v, signed.r, signed.s);

    expect(await dms.getStage()).to.equal(STAGE.SAFE);
    expect(await dms.nonce()).to.equal(1);
  });

  // --- Week 1: Evidence Hash & Permanent Release Latch ---
  it("registers the keccak256 evidence hash and rejects zero hashes or non-owners", async function () {
    const { dms, otherAccount } = await deploySwitchFixture();
    const sampleHash = ethers.keccak256(ethers.toUtf8Bytes("encrypted-dummy-evidence"));

    await expect(
      dms.connect(otherAccount).registerEvidence(sampleHash)
    ).to.be.revertedWith("Not owner");

    await expect(
      dms.registerEvidence(ethers.ZeroHash)
    ).to.be.revertedWith("Invalid evidence hash");

    await dms.registerEvidence(sampleHash);
    expect(await dms.evidenceHash()).to.equal(sampleHash);
  });

  it("prevents early release latch before 5 days", async function () {
    const { dms } = await deploySwitchFixture();
    await time.increase(4 * ONE_DAY + 23 * ONE_HOUR);

    await expect(dms.finalizeRelease()).to.be.revertedWith("Release threshold not reached");
    expect(await dms.released()).to.equal(false);
  });

  it("latches release permanently at 5 days and rejects subsequent signed check-ins", async function () {
    const { dms, owner } = await deploySwitchFixture();

    await time.increase(5 * ONE_DAY);
    await dms.finalizeRelease();

    expect(await dms.released()).to.equal(true);
    expect(await dms.getStage()).to.equal(STAGE.RELEASED);

    const latestTime = await time.latest();
    const signed = await signCheckIn(dms, owner, {
      nonce: 0,
      deadline: latestTime + ONE_HOUR,
    });

    await expect(
      dms.checkInWithSignature(signed.nonce, signed.deadline, signed.duress, signed.v, signed.r, signed.s)
    ).to.be.revertedWith("Switch already released");
  });

  it("emits EvidenceRegistered, CheckedIn, and Released events", async function () {
    const { dms, owner } = await deploySwitchFixture();
    const sampleHash = ethers.keccak256(ethers.toUtf8Bytes("encrypted-dummy-evidence"));

    await expect(dms.registerEvidence(sampleHash)).to.emit(dms, "EvidenceRegistered");

    const latestTime = await time.latest();
    const signed = await signCheckIn(dms, owner, {
      nonce: 0,
      deadline: latestTime + ONE_HOUR,
    });

    await expect(
      dms.checkInWithSignature(signed.nonce, signed.deadline, signed.duress, signed.v, signed.r, signed.s)
    ).to.emit(dms, "CheckedIn");

    await time.increase(5 * ONE_DAY);
    await expect(dms.finalizeRelease()).to.emit(dms, "Released");
  });

  // --- Day 8: EIP-712 Signature Validation ---
  it("rejects signatures signed by a non-owner account", async function () {
    const { dms, otherAccount } = await deploySwitchFixture();
    const latestTime = await time.latest();

    const forged = await signCheckIn(dms, otherAccount, {
      nonce: 0,
      deadline: latestTime + ONE_HOUR,
    });

    await expect(
      dms.checkInWithSignature(forged.nonce, forged.deadline, forged.duress, forged.v, forged.r, forged.s)
    ).to.be.revertedWith("Invalid signature");
  });

  it("rejects expired EIP-712 check-in signatures", async function () {
    const { dms, owner } = await deploySwitchFixture();
    const latestTime = await time.latest();

    const expired = await signCheckIn(dms, owner, {
      nonce: 0,
      deadline: latestTime + ONE_MINUTE,
    });

    // Advance past the 1-minute signature deadline
    await time.increase(2 * ONE_MINUTE);

    await expect(
      dms.checkInWithSignature(expired.nonce, expired.deadline, expired.duress, expired.v, expired.r, expired.s)
    ).to.be.revertedWith("Signature expired");
  });
});