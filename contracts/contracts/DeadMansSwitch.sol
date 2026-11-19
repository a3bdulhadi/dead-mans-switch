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

    // EIP-712 Typed-Data Constants (Day 8)
    bytes32 public constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 public constant CHECKIN_TYPEHASH = keccak256(
        "CheckIn(uint256 nonce,uint256 deadline,bool duress)"
    );

    bytes32 public immutable DOMAIN_SEPARATOR;
    uint256 public nonce;

    // Events for audit log and release agent monitoring
    event EvidenceRegistered(address indexed owner, bytes32 indexed evidenceHash, uint256 timestamp);
    event CheckedIn(address indexed owner, uint256 indexed nonce, uint256 timestamp);
    event Released(address indexed triggeredBy, uint256 timestamp);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
        lastCheckIn = block.timestamp;
        released = false;

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes("DeadMansSwitch")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );

        emit CheckedIn(msg.sender, 0, block.timestamp);
    }

    // Store the keccak256 hash of the encrypted evidence file
    function registerEvidence(bytes32 _evidenceHash) external onlyOwner {
        require(!released, "Already released");
        require(_evidenceHash != bytes32(0), "Invalid evidence hash");
        evidenceHash = _evidenceHash;
        emit EvidenceRegistered(msg.sender, _evidenceHash, block.timestamp);
    }

    // 4-rule stage function
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

    // EIP-712 Signed Check-In (replaces temporary ping())
    function checkInWithSignature(
        uint256 _nonce,
        uint256 _deadline,
        bool _duress,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(!released && getStage() != Stage.RELEASED, "Switch already released");
        require(block.timestamp <= _deadline, "Signature expired");
        require(_nonce == nonce, "Invalid nonce");

        bytes32 structHash = keccak256(
            abi.encode(CHECKIN_TYPEHASH, _nonce, _deadline, _duress)
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash)
        );

        address recoveredSigner = ecrecover(digest, v, r, s);
        require(recoveredSigner != address(0) && recoveredSigner == owner, "Invalid signature");

        nonce = _nonce + 1;
        lastCheckIn = block.timestamp;

        // Note: _duress silent alert handling will be wired up on Day 10
        emit CheckedIn(owner, _nonce, block.timestamp);
    }

    // Permanent release latch called at Day 5+
    function finalizeRelease() external {
        require(!released, "Already latched");
        require(block.timestamp - lastCheckIn >= RELEASE_THRESHOLD, "Release threshold not reached");
        released = true;
        emit Released(msg.sender, block.timestamp);
    }
}