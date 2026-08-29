// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract MultiSigWallet {
    // ============ Events ============
    event Deposit(address indexed sender, uint256 amount, uint256 balance);
    event SubmitTransaction(
        address indexed owner,
        uint256 indexed txId,
        address indexed to,
        uint256 value,
        bytes data
    );
    event ConfirmTransaction(address indexed owner, uint256 indexed txId);
    event RevokeConfirmation(address indexed owner, uint256 indexed txId);
    event ExecuteTransaction(address indexed owner, uint256 indexed txId);
    event CancelTransaction(address indexed caller, uint256 indexed txId);
    event OwnerAdded(address indexed newOwner);
    event OwnerRemoved(address indexed removedOwner);
    event ThresholdChanged(uint256 newThreshold);

    // ============ State variables ============
    address[] public owners;
    mapping(address => bool) public isOwner;
    uint256 public numConfirmationsRequired;

    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        bool executed;
        bool cancelled;
        uint256 numConfirmations;
        address submitter;
    }

    Transaction[] public transactions;

    // txId => owner => confirmed?
    mapping(uint256 => mapping(address => bool)) public isConfirmed;

    // ============ Modifiers ============
    modifier onlyOwner() {
        _onlyOwner();
        _;
    }
    function _onlyOwner() internal view {
        require(isOwner[msg.sender], "Not an owner");
    }

    modifier onlySelf() {
        _onlySelf();
        _;
    }
    function _onlySelf() internal view {
        require(msg.sender == address(this), "Only wallet itself can call");
    }

    modifier txExists(uint256 _txId) {
        _txExists(_txId);
        _;
    }
    function _txExists(uint256 _txId) internal view {
        require(_txId < transactions.length, "Tx does not exist");
    }

    modifier notExecuted(uint256 _txId) {
        _notExecuted(_txId);
        _;
    }
    function _notExecuted(uint256 _txId) internal view {
        require(!transactions[_txId].executed, "Tx already executed");
    }

    modifier notConfirmed(uint256 _txId) {
        _notConfirmed(_txId);
        _;
    }
    function _notConfirmed(uint256 _txId) internal view {
        require(!isConfirmed[_txId][msg.sender], "Tx already confirmed");
    }

    modifier notCancelled(uint256 _txId) {
        _notCancelled(_txId);
        _;
    }
    function _notCancelled(uint256 _txId) internal view {
        require(!transactions[_txId].cancelled, "Tx is cancelled");
    }

    // ============ Constructor ============
    constructor(address[] memory _owners, uint256 _numConfirmationsRequired) {
        require(_owners.length > 0, "Owners required");
        require(
            _numConfirmationsRequired > 0 &&
                _numConfirmationsRequired <= _owners.length,
            "Invalid number of required confirmations"
        );

        for (uint256 i = 0; i < _owners.length; i++) {
            address owner = _owners[i];

            require(owner != address(0), "Invalid owner");
            require(!isOwner[owner], "Owner not unique");

            isOwner[owner] = true;
            owners.push(owner);
        }

        numConfirmationsRequired = _numConfirmationsRequired;
    }

    // ============ Receive ETH ============
    receive() external payable {
        emit Deposit(msg.sender, msg.value, address(this).balance);
    }

    // ============ Core: Submit / Confirm / Execute / Cancel ============

    function submitTransaction(
        address _to,
        uint256 _value,
        bytes memory _data
    ) external onlyOwner {
        require(_to != address(0), "Invalid recipient");

        uint256 txId = transactions.length;

        transactions.push(
            Transaction({
                to: _to,
                value: _value,
                data: _data,
                executed: false,
                cancelled: false,
                numConfirmations: 0,
                submitter: msg.sender
            })
        );

        emit SubmitTransaction(msg.sender, txId, _to, _value, _data);
    }

    function confirmTransaction(
        uint256 _txId
    )
        external
        onlyOwner
        txExists(_txId)
        notExecuted(_txId)
        notCancelled(_txId)
        notConfirmed(_txId)
    {
        Transaction storage transaction = transactions[_txId];
        transaction.numConfirmations += 1;
        isConfirmed[_txId][msg.sender] = true;

        emit ConfirmTransaction(msg.sender, _txId);
    }

    function executeTransaction(
        uint256 _txId
    ) external onlyOwner txExists(_txId) notExecuted(_txId) notCancelled(_txId) {
        Transaction storage transaction = transactions[_txId];

        uint256 validConfirmations = _countValidConfirmations(_txId);

        require(
            validConfirmations >= numConfirmationsRequired,
            "Cannot execute: not enough confirmations"
        );

        transaction.executed = true;

        (bool success, ) = transaction.to.call{value: transaction.value}(
            transaction.data
        );
        require(success, "Tx failed");

        emit ExecuteTransaction(msg.sender, _txId);
    }

    function revokeConfirmation(
        uint256 _txId
    ) external onlyOwner txExists(_txId) notExecuted(_txId) notCancelled(_txId) {
        Transaction storage transaction = transactions[_txId];

        require(isConfirmed[_txId][msg.sender], "Tx not confirmed");

        transaction.numConfirmations -= 1;
        isConfirmed[_txId][msg.sender] = false;

        emit RevokeConfirmation(msg.sender, _txId);
    }

    function cancelTransaction(
        uint256 _txId
    ) external txExists(_txId) notExecuted(_txId) notCancelled(_txId) {
        Transaction storage transaction = transactions[_txId];

        require(
            msg.sender == transaction.submitter || msg.sender == address(this),
            "Not authorized to cancel"
        );

        transaction.cancelled = true;

        emit CancelTransaction(msg.sender, _txId);
    }

    function _countValidConfirmations(uint256 _txId) internal view returns (uint256) {
        uint256 count = 0;
        uint256 length = owners.length;

        for (uint256 i = 0; i < length; i++) {
            if (isConfirmed[_txId][owners[i]]) {
                count += 1;
            }
        }

        return count;
    }

    // ============ Self-governance: Owner management ============

    function addOwner(address _newOwner) external onlySelf {
        require(_newOwner != address(0), "Invalid owner");
        require(!isOwner[_newOwner], "Owner already exists");

        isOwner[_newOwner] = true;
        owners.push(_newOwner);

        emit OwnerAdded(_newOwner);
    }

    function removeOwner(address _owner) external onlySelf {
        require(isOwner[_owner], "Not an owner");
        require(
            owners.length - 1 >= numConfirmationsRequired,
            "Cannot remove: owners would be less than threshold"
        );

        isOwner[_owner] = false;

        uint256 length = owners.length;
        for (uint256 i = 0; i < length; i++) {
            if (owners[i] == _owner) {
                owners[i] = owners[length - 1];
                owners.pop();
                break;
            }
        }

        emit OwnerRemoved(_owner);
    }

    function changeThreshold(uint256 _newThreshold) external onlySelf {
        require(_newThreshold > 0, "Threshold must be > 0");
        require(_newThreshold <= owners.length, "Threshold too high");

        numConfirmationsRequired = _newThreshold;

        emit ThresholdChanged(_newThreshold);
    }

    // ============ View helpers ============

    function getOwners() external view returns (address[] memory) {
        return owners;
    }

    function getTransactionCount() external view returns (uint256) {
        return transactions.length;
    }

    function getAllTransactions() external view returns (Transaction[] memory) {
        return transactions;
    }

    function getTransaction(
        uint256 _txId
    )
        external
        view
        returns (
            address to,
            uint256 value,
            bytes memory data,
            bool executed,
            bool cancelled,
            uint256 numConfirmations,
            address submitter
        )
    {
        Transaction storage transaction = transactions[_txId];

        return (
            transaction.to,
            transaction.value,
            transaction.data,
            transaction.executed,
            transaction.cancelled,
            transaction.numConfirmations,
            transaction.submitter
        );
    }
}