// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";
import {MultiSigWallet} from "../src/MultiSigWallet.sol";

contract MultiSigWalletTest is Test {
    MultiSigWallet public wallet;

    address public owner1 = address(0x1);
    address public owner2 = address(0x2);
    address public owner3 = address(0x3);
    address public notOwner = address(0x4);

    address[] public owners;
    uint256 public constant THRESHOLD = 2;

    function setUp() public {
        owners.push(owner1);
        owners.push(owner2);
        owners.push(owner3);

        wallet = new MultiSigWallet(owners, THRESHOLD);

        vm.deal(address(wallet), 10 ether);
    }

    // ============ Constructor tests ============

    function test_ConstructorSetsOwnersCorrectly() public view {
        address[] memory storedOwners = wallet.getOwners();
        assertEq(storedOwners.length, 3);
        assertEq(storedOwners[0], owner1);
        assertTrue(wallet.isOwner(owner1));
        assertTrue(wallet.isOwner(owner2));
        assertTrue(wallet.isOwner(owner3));
        assertFalse(wallet.isOwner(notOwner));
    }

    function test_ConstructorSetsThreshold() public view {
        assertEq(wallet.numConfirmationsRequired(), THRESHOLD);
    }

    function test_RevertWhen_NoOwners() public {
        address[] memory emptyOwners = new address[](0);
        vm.expectRevert("Owners required");
        new MultiSigWallet(emptyOwners, 1);
    }

    function test_RevertWhen_ThresholdZero() public {
        vm.expectRevert("Invalid number of required confirmations");
        new MultiSigWallet(owners, 0);
    }

    function test_RevertWhen_ThresholdExceedsOwners() public {
        vm.expectRevert("Invalid number of required confirmations");
        new MultiSigWallet(owners, 4);
    }

    function test_RevertWhen_DuplicateOwner() public {
        address[] memory dupOwners = new address[](2);
        dupOwners[0] = owner1;
        dupOwners[1] = owner1;
        vm.expectRevert("Owner not unique");
        new MultiSigWallet(dupOwners, 1);
    }

    // ============ Submit Transaction tests ============

    function test_OwnerCanSubmitTransaction() public {
        vm.prank(owner1);
        wallet.submitTransaction(address(0x999), 1 ether, "");

        assertEq(wallet.getTransactionCount(), 1);

        (
            address to,
            uint256 value,
            bytes memory data,
            bool executed,
            bool cancelled,
            uint256 numConfirmations,
            address submitter
        ) = wallet.getTransaction(0);

        assertEq(to, address(0x999));
        assertEq(value, 1 ether);
        assertEq(data.length, 0);
        assertFalse(executed);
        assertFalse(cancelled);
        assertEq(numConfirmations, 0);
        assertEq(submitter, owner1);
    }

    function test_RevertWhen_NotOwnerSubmits() public {
        vm.prank(notOwner);
        vm.expectRevert("Not an owner");
        wallet.submitTransaction(address(0x999), 1 ether, "");
    }

    function test_RevertWhen_SubmitToZeroAddress() public {
        vm.prank(owner1);
        vm.expectRevert("Invalid recipient");
        wallet.submitTransaction(address(0), 1 ether, "");
    }

    // ============ Confirm Transaction tests ============

    function _submitSampleTx() internal returns (uint256 txId) {
        vm.prank(owner1);
        wallet.submitTransaction(address(0x999), 1 ether, "");
        return 0;
    }

    function test_OwnerCanConfirmTransaction() public {
        uint256 txId = _submitSampleTx();

        vm.prank(owner1);
        wallet.confirmTransaction(txId);

        assertTrue(wallet.isConfirmed(txId, owner1));

        (, , , , , uint256 numConfirmations, ) = wallet.getTransaction(txId);
        assertEq(numConfirmations, 1);
    }

    function test_RevertWhen_ConfirmingTwice() public {
        uint256 txId = _submitSampleTx();

        vm.prank(owner1);
        wallet.confirmTransaction(txId);

        vm.prank(owner1);
        vm.expectRevert("Tx already confirmed");
        wallet.confirmTransaction(txId);
    }

    function test_RevertWhen_NotOwnerConfirms() public {
        uint256 txId = _submitSampleTx();

        vm.prank(notOwner);
        vm.expectRevert("Not an owner");
        wallet.confirmTransaction(txId);
    }

    function test_RevertWhen_ConfirmingNonexistentTx() public {
        vm.prank(owner1);
        vm.expectRevert("Tx does not exist");
        wallet.confirmTransaction(999);
    }

    // ============ Execute Transaction tests ============

    function test_ExecuteTransactionSendsETH() public {
        uint256 txId = _submitSampleTx();
        address payable recipient = payable(address(0x999));

        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        uint256 balanceBefore = recipient.balance;

        vm.prank(owner1);
        wallet.executeTransaction(txId);

        assertEq(recipient.balance, balanceBefore + 1 ether);

        (, , , bool executed, , , ) = wallet.getTransaction(txId);
        assertTrue(executed);
    }

    function test_RevertWhen_NotEnoughConfirmations() public {
        uint256 txId = _submitSampleTx();

        vm.prank(owner1);
        wallet.confirmTransaction(txId);

        vm.prank(owner1);
        vm.expectRevert("Cannot execute: not enough confirmations");
        wallet.executeTransaction(txId);
    }

    function test_RevertWhen_ExecutingTwice() public {
        uint256 txId = _submitSampleTx();

        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        vm.prank(owner1);
        wallet.executeTransaction(txId);

        vm.prank(owner1);
        vm.expectRevert("Tx already executed");
        wallet.executeTransaction(txId);
    }

    // ============ onlySelf protection tests ============

    function test_RevertWhen_AddOwnerCalledDirectly() public {
        vm.prank(owner1);
        vm.expectRevert("Only wallet itself can call");
        wallet.addOwner(address(0x999));
    }

    function test_RevertWhen_RemoveOwnerCalledDirectly() public {
        vm.prank(owner1);
        vm.expectRevert("Only wallet itself can call");
        wallet.removeOwner(owner2);
    }

    function test_RevertWhen_ChangeThresholdCalledDirectly() public {
        vm.prank(owner1);
        vm.expectRevert("Only wallet itself can call");
        wallet.changeThreshold(1);
    }

    // ============ addOwner / removeOwner / changeThreshold via multisig ============

    function test_AddOwnerThroughMultisigFlow() public {
        address newOwner = address(0x999);

        bytes memory data = abi.encodeWithSignature(
            "addOwner(address)",
            newOwner
        );

        vm.prank(owner1);
        wallet.submitTransaction(address(wallet), 0, data);
        uint256 txId = 0;

        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        assertFalse(wallet.isOwner(newOwner));

        vm.prank(owner1);
        wallet.executeTransaction(txId);

        assertTrue(wallet.isOwner(newOwner));

        address[] memory owners_ = wallet.getOwners();
        assertEq(owners_.length, 4);
        assertEq(owners_[3], newOwner);
    }

    function test_RemoveOwnerThroughMultisigFlow() public {
        bytes memory data = abi.encodeWithSignature(
            "removeOwner(address)",
            owner3
        );

        vm.prank(owner1);
        wallet.submitTransaction(address(wallet), 0, data);
        uint256 txId = 0;

        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        vm.prank(owner1);
        wallet.executeTransaction(txId);

        assertFalse(wallet.isOwner(owner3));
        assertEq(wallet.getOwners().length, 2);
    }

    function test_RevertWhen_RemoveOwnerBreaksThreshold() public {
        bytes memory data1 = abi.encodeWithSignature(
            "removeOwner(address)",
            owner3
        );
        vm.prank(owner1);
        wallet.submitTransaction(address(wallet), 0, data1);
        vm.prank(owner1);
        wallet.confirmTransaction(0);
        vm.prank(owner2);
        wallet.confirmTransaction(0);
        vm.prank(owner1);
        wallet.executeTransaction(0);

        bytes memory data2 = abi.encodeWithSignature(
            "removeOwner(address)",
            owner2
        );
        vm.prank(owner1);
        wallet.submitTransaction(address(wallet), 0, data2);
        vm.prank(owner1);
        wallet.confirmTransaction(1);
        vm.prank(owner2);
        wallet.confirmTransaction(1);

        vm.prank(owner1);
        vm.expectRevert("Tx failed");
        wallet.executeTransaction(1);
    }

    function test_ChangeThresholdThroughMultisigFlow() public {
        bytes memory data = abi.encodeWithSignature(
            "changeThreshold(uint256)",
            3
        );

        vm.prank(owner1);
        wallet.submitTransaction(address(wallet), 0, data);
        vm.prank(owner1);
        wallet.confirmTransaction(0);
        vm.prank(owner2);
        wallet.confirmTransaction(0);
        vm.prank(owner1);
        wallet.executeTransaction(0);

        assertEq(wallet.numConfirmationsRequired(), 3);
    }

    // ============ Stale confirmation (audit finding) ============

    function test_StaleConfirmation() public {
        vm.prank(owner1);
        wallet.submitTransaction(notOwner, 1 ether, "");
        uint256 txId1 = 0;

        vm.prank(owner3);
        wallet.confirmTransaction(txId1);

        bytes memory data = abi.encodeWithSignature("removeOwner(address)", owner3);

        vm.prank(owner1);
        wallet.submitTransaction(address(wallet), 0, data);
        uint256 txId2 = 1;

        vm.prank(owner1);
        wallet.confirmTransaction(txId2);
        vm.prank(owner2);
        wallet.confirmTransaction(txId2);

        vm.prank(owner1);
        wallet.executeTransaction(txId2);

        assertFalse(wallet.isOwner(owner3));

        vm.prank(owner2);
        wallet.confirmTransaction(txId1);

        vm.prank(owner1);
        vm.expectRevert("Cannot execute: not enough confirmations");
        wallet.executeTransaction(txId1);
    }

    // ============ getAllTransactions ============

    function test_GetAllTransactions() public {
        vm.prank(owner1);
        wallet.submitTransaction(notOwner, 1 ether, "");

        vm.prank(owner2);
        wallet.submitTransaction(owner3, 0.5 ether, "");

        MultiSigWallet.Transaction[] memory allTxs = wallet.getAllTransactions();

        assertEq(allTxs.length, 2);
        assertEq(allTxs[0].to, notOwner);
        assertEq(allTxs[1].to, owner3);
    }

    // ============ Cancel Transaction tests ============

    function test_SubmitterCanCancelOwnTransaction() public {
        uint256 txId = _submitSampleTx(); // submitted by owner1

        vm.prank(owner1);
        wallet.cancelTransaction(txId);

        (, , , , bool cancelled, , ) = wallet.getTransaction(txId);
        assertTrue(cancelled);
    }

    function test_RevertWhen_NonSubmitterCancels() public {
        uint256 txId = _submitSampleTx(); // submitted by owner1

        vm.prank(owner2);
        vm.expectRevert("Not authorized to cancel");
        wallet.cancelTransaction(txId);
    }

    function test_RevertWhen_ConfirmingCancelledTx() public {
        uint256 txId = _submitSampleTx();

        vm.prank(owner1);
        wallet.cancelTransaction(txId);

        vm.prank(owner2);
        vm.expectRevert("Tx is cancelled");
        wallet.confirmTransaction(txId);
    }

    function test_RevertWhen_ExecutingCancelledTx() public {
        uint256 txId = _submitSampleTx();

        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        vm.prank(owner1);
        wallet.cancelTransaction(txId);

        vm.prank(owner1);
        vm.expectRevert("Tx is cancelled");
        wallet.executeTransaction(txId);
    }

    function test_RevertWhen_CancellingExecutedTx() public {
        uint256 txId = _submitSampleTx();

        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        vm.prank(owner2);
        wallet.confirmTransaction(txId);
        vm.prank(owner1);
        wallet.executeTransaction(txId);

        vm.prank(owner1);
        vm.expectRevert("Tx already executed");
        wallet.cancelTransaction(txId);
    }

    function test_RevertWhen_CancellingAlreadyCancelledTx() public {
        uint256 txId = _submitSampleTx();

        vm.prank(owner1);
        wallet.cancelTransaction(txId);

        vm.prank(owner1);
        vm.expectRevert("Tx is cancelled");
        wallet.cancelTransaction(txId);
    }

    function test_CancelTransactionThroughMultisigFlow() public {
        // owner2 submits a tx that owner1 doesn't like
        vm.prank(owner2);
        wallet.submitTransaction(address(0x999), 1 ether, "");
        uint256 targetTxId = 0;

        // Other owners submit+confirm+execute a cancelTransaction call
        bytes memory data = abi.encodeWithSignature(
            "cancelTransaction(uint256)",
            targetTxId
        );

        vm.prank(owner1);
        wallet.submitTransaction(address(wallet), 0, data);
        uint256 cancelTxId = 1;

        vm.prank(owner1);
        wallet.confirmTransaction(cancelTxId);
        vm.prank(owner2);
        wallet.confirmTransaction(cancelTxId);

        vm.prank(owner1);
        wallet.executeTransaction(cancelTxId);

        (, , , , bool cancelled, , ) = wallet.getTransaction(targetTxId);
        assertTrue(cancelled);
    }
}