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

    // Events for audit log and release agent monitoring (Day 6)
    event EvidenceRegistered(address indexed owner, bytes32 indexed evidenceHash, uint256 timestamp);
    event CheckedIn(address indexed owner, uint256 timestamp);
    event Released(address indexed triggeredBy, uint256 timestamp);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
        lastCheckIn = block.timestamp;
        released = false;
        emit CheckedIn(msg.sender, block.timestamp);
    }

    // Store the keccak256 hash of the encrypted evidence file (Synopsis Section 5.3)
    function registerEvidence(bytes32 _evidenceHash) external onlyOwner {
        require(!released, "Already released");
        require(_evidenceHash != bytes32(0), "Invalid evidence hash");
        evidenceHash = _evidenceHash;
        emit EvidenceRegistered(msg.sender, _evidenceHash, block.timestamp);
    }

    // 4-rule stage function from Synopsis Section 5.3
    function getStage() public view returns (Stage) {
        if (released) {
            return Stage.RELEASED;
        }

        uint256 elapsed = block.timestamp - lastCheckIn;

        if (elapsed < ALERT_THRESHOLD) {
            return Stage.SAFE;
        } else if (elapsed < RELEASE_THRESHOLD) {
            return Stage.ALERT;
        } else {
            return Stage.RELEASED;
        }
    }

    // Check-in helper (will be upgraded to EIP-712 signed check-ins in Week 2)
    function ping() external onlyOwner {
        require(!released && getStage() != Stage.RELEASED, "Switch already released");
        lastCheckIn = block.timestamp;
        emit CheckedIn(msg.sender, block.timestamp);
    }

    // Permanent release latch called at Day 5+ (Synopsis Section 5.3)
    function finalizeRelease() external {
        require(!released, "Already latched");
        require(block.timestamp - lastCheckIn >= RELEASE_THRESHOLD, "Release threshold not reached");
        released = true;
        emit Released(msg.sender, block.timestamp);
    }
}