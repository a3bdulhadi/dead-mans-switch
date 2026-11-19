// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract DeadMansSwitch {
    // Three stages defined in Synopsis Section 5.2
    enum Stage {
        SAFE,     // 0: 0 to < 2 days since last check-in
        ALERT,    // 1: 2 to < 5 days since last check-in
        RELEASED  // 2: >= 5 days since last check-in, or permanently latched
    }

    address public owner;
    uint256 public lastCheckIn;
    bytes32 public evidenceHash;
    bool public released;

    uint256 public constant ALERT_THRESHOLD = 2 days;
    uint256 public constant RELEASE_THRESHOLD = 5 days;

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
        lastCheckIn = block.timestamp;
        released = false;
    }

    // Store the keccak256 hash of the encrypted evidence file (Synopsis Section 5.3)
    function registerEvidence(bytes32 _evidenceHash) external onlyOwner {
        require(!released, "Already released");
        require(_evidenceHash != bytes32(0), "Invalid evidence hash");
        evidenceHash = _evidenceHash;
    }

    // 4-rule stage function from Synopsis Section 5.3
    function getStage() public view returns (Stage) {
        // Rule 1: If release has already been finalized, stage is RELEASED
        if (released) {
            return Stage.RELEASED;
        }

        uint256 elapsed = block.timestamp - lastCheckIn;

        // Rule 2: Less than 2 days since last check-in -> SAFE
        if (elapsed < ALERT_THRESHOLD) {
            return Stage.SAFE;
        }
        // Rule 3: Less than 5 days since last check-in -> ALERT
        else if (elapsed < RELEASE_THRESHOLD) {
            return Stage.ALERT;
        }
        // Rule 4: 5 days or more -> RELEASED
        else {
            return Stage.RELEASED;
        }
    }

    // Check-in helper (will be upgraded to EIP-712 signed check-ins in Week 2)
    function ping() external onlyOwner {
        // Reject check-ins if already latched OR if 5 days have already elapsed
        require(!released && getStage() != Stage.RELEASED, "Switch already released");
        lastCheckIn = block.timestamp;
    }

    // Permanent release latch called at Day 5+ (Synopsis Section 5.3)
    function finalizeRelease() external {
        require(!released, "Already latched");
        require(block.timestamp - lastCheckIn >= RELEASE_THRESHOLD, "Release threshold not reached");
        released = true;
    }
}