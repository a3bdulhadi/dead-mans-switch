const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("DeadMansSwitch - Boundaries, Hash & Release Latch (Days 3-4)", function () {
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

  // --- Day 3: Stage Boundaries ---
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

  it("resets back to SAFE when owner checks in during ALERT stage", async function () {
    const { dms } = await deploySwitchFixture();
    await time.increase(3 * ONE_DAY);
    expect(await dms.getStage()).to.equal(STAGE.ALERT);

    await dms.ping();
    expect(await dms.getStage()).to.equal(STAGE.SAFE);
  });

  // --- Day 4: Evidence Hash & Permanent Release Latch ---
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

  it("latches release permanently at 5 days and rejects subsequent check-ins", async function () {
    const { dms } = await deploySwitchFixture();

    // Advance past 5 days and latch the release
    await time.increase(5 * ONE_DAY);
    await dms.finalizeRelease();

    expect(await dms.released()).to.equal(true);
    expect(await dms.getStage()).to.equal(STAGE.RELEASED);

    // A late check-in must be rejected after release
    await expect(dms.ping()).to.be.revertedWith("Switch already released");
    expect(await dms.getStage()).to.equal(STAGE.RELEASED);
  });

  it("rejects late check-ins at 5 days even before finalizeRelease() is called", async function () {
    const { dms } = await deploySwitchFixture();
    await time.increase(5 * ONE_DAY);

    await expect(dms.ping()).to.be.revertedWith("Switch already released");
  });
// --- Day 6: Events ---
  it("emits EvidenceRegistered, CheckedIn, and Released events", async function () {
    const { dms, owner } = await deploySwitchFixture();
    const sampleHash = ethers.keccak256(ethers.toUtf8Bytes("encrypted-dummy-evidence"));

    await expect(dms.registerEvidence(sampleHash))
      .to.emit(dms, "EvidenceRegistered");

    await expect(dms.ping())
      .to.emit(dms, "CheckedIn");

    await time.increase(5 * ONE_DAY);
    await expect(dms.finalizeRelease())
      .to.emit(dms, "Released");
  });
});