const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("DeadMansSwitch - Stage Boundaries (Day 3)", function () {
  // Stage enum values matching DeadMansSwitch.sol:
  // 0 = SAFE, 1 = ALERT, 2 = RELEASED
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

    // Advance 3 days into ALERT
    await time.increase(3 * ONE_DAY);
    expect(await dms.getStage()).to.equal(STAGE.ALERT);

    // Owner checks in
    await dms.ping();
    expect(await dms.getStage()).to.equal(STAGE.SAFE);
  });
});