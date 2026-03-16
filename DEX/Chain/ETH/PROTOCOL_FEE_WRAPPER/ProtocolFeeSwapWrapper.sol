// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IWrappedNative is IERC20 {
    function withdraw(uint256 amount) external;
}

contract ProtocolFeeSwapWrapper {
    uint256 public constant FEE_DENOMINATOR = 10_000;

    address public owner;
    address public feeRecipient;
    address public immutable wrappedNative;
    uint256 public immutable feeBps;

    mapping(address => bool) public allowedRouters;

    uint256 private unlocked = 1;

    error Unauthorized();
    error InvalidAddress();
    error InvalidFeeBps();
    error RouterNotAllowed(address router);
    error ZeroAmount();
    error FeeExceedsAmount();
    error UnsupportedTokenBehavior();
    error NoNativeReceived();
    error NativeTransferFailed(address to, uint256 amount);
    error TokenCallFailed(address token);
    error InsufficientNetOutput(uint256 minNetOut, uint256 actualNetOut);

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event FeeRecipientUpdated(address indexed previousRecipient, address indexed newRecipient);
    event RouterUpdated(address indexed router, bool allowed);
    event NativeBuyExecuted(
        address indexed caller,
        address indexed router,
        uint256 totalValue,
        uint256 feeAmount,
        uint256 swapValue
    );
    event TokenSellExecuted(
        address indexed caller,
        address indexed router,
        address indexed tokenIn,
        uint256 amountIn,
        uint256 grossNativeOut,
        uint256 feeAmount,
        uint256 netNativeOut
    );

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier nonReentrant() {
        if (unlocked != 1) revert Unauthorized();
        unlocked = 2;
        _;
        unlocked = 1;
    }

    constructor(
        address wrappedNative_,
        address feeRecipient_,
        uint256 feeBps_,
        address[] memory initialRouters
    ) {
        if (wrappedNative_ == address(0) || feeRecipient_ == address(0)) revert InvalidAddress();
        if (feeBps_ == 0 || feeBps_ > 100) revert InvalidFeeBps();

        owner = msg.sender;
        wrappedNative = wrappedNative_;
        feeRecipient = feeRecipient_;
        feeBps = feeBps_;

        emit OwnershipTransferred(address(0), msg.sender);
        emit FeeRecipientUpdated(address(0), feeRecipient_);

        for (uint256 i = 0; i < initialRouters.length; i++) {
            _setRouter(initialRouters[i], true);
        }
    }

    receive() external payable {}

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setFeeRecipient(address newFeeRecipient) external onlyOwner {
        if (newFeeRecipient == address(0)) revert InvalidAddress();
        emit FeeRecipientUpdated(feeRecipient, newFeeRecipient);
        feeRecipient = newFeeRecipient;
    }

    function setAllowedRouter(address router, bool allowed) external onlyOwner {
        _setRouter(router, allowed);
    }

    function previewFee(uint256 grossNativeAmount) external view returns (uint256 feeAmount, uint256 netAmount) {
        feeAmount = (grossNativeAmount * feeBps) / FEE_DENOMINATOR;
        netAmount = grossNativeAmount - feeAmount;
    }

    function buyWithNative(address router, bytes calldata routerCalldata)
        external
        payable
        nonReentrant
        returns (uint256 feeAmount, uint256 swapValue)
    {
        if (!allowedRouters[router]) revert RouterNotAllowed(router);
        if (msg.value == 0) revert ZeroAmount();

        feeAmount = (msg.value * feeBps) / FEE_DENOMINATOR;
        swapValue = msg.value - feeAmount;

        if (swapValue == 0) revert FeeExceedsAmount();

        _callRouter(router, swapValue, routerCalldata);
        _sendNative(feeRecipient, feeAmount);

        emit NativeBuyExecuted(msg.sender, router, msg.value, feeAmount, swapValue);
    }

    function sellTokenForNative(
        address router,
        address tokenIn,
        uint256 amountIn,
        uint256 minNetNativeOut,
        bytes calldata routerCalldata
    )
        external
        nonReentrant
        returns (uint256 grossNativeOut, uint256 feeAmount, uint256 netNativeOut)
    {
        if (!allowedRouters[router]) revert RouterNotAllowed(router);
        if (tokenIn == address(0)) revert InvalidAddress();
        if (amountIn == 0) revert ZeroAmount();

        uint256 nativeBalanceBefore = address(this).balance;
        uint256 wrappedBalanceBefore = IERC20(wrappedNative).balanceOf(address(this));
        uint256 tokenBalanceBefore = IERC20(tokenIn).balanceOf(address(this));

        _safeTransferFrom(tokenIn, msg.sender, address(this), amountIn);

        uint256 tokenBalanceAfterTransfer = IERC20(tokenIn).balanceOf(address(this));
        uint256 receivedAmount = tokenBalanceAfterTransfer - tokenBalanceBefore;
        if (receivedAmount != amountIn) revert UnsupportedTokenBehavior();

        _forceApprove(tokenIn, router, 0);
        _forceApprove(tokenIn, router, amountIn);

        _callRouter(router, 0, routerCalldata);

        _forceApprove(tokenIn, router, 0);

        uint256 wrappedBalanceAfter = IERC20(wrappedNative).balanceOf(address(this));
        uint256 wrappedReceived = wrappedBalanceAfter - wrappedBalanceBefore;
        if (wrappedReceived > 0) {
            IWrappedNative(wrappedNative).withdraw(wrappedReceived);
        }

        grossNativeOut = address(this).balance - nativeBalanceBefore;
        if (grossNativeOut == 0) revert NoNativeReceived();

        feeAmount = (grossNativeOut * feeBps) / FEE_DENOMINATOR;
        netNativeOut = grossNativeOut - feeAmount;

        if (netNativeOut < minNetNativeOut) {
            revert InsufficientNetOutput(minNetNativeOut, netNativeOut);
        }

        uint256 leftoverInput = IERC20(tokenIn).balanceOf(address(this)) - tokenBalanceBefore;
        if (leftoverInput > 0) {
            _safeTransfer(tokenIn, msg.sender, leftoverInput);
        }

        _sendNative(feeRecipient, feeAmount);
        _sendNative(msg.sender, netNativeOut);

        emit TokenSellExecuted(msg.sender, router, tokenIn, amountIn, grossNativeOut, feeAmount, netNativeOut);
    }

    function _setRouter(address router, bool allowed) internal {
        if (router == address(0)) revert InvalidAddress();
        allowedRouters[router] = allowed;
        emit RouterUpdated(router, allowed);
    }

    function _callRouter(address router, uint256 value, bytes calldata data) internal {
        (bool success, bytes memory returnData) = router.call{value: value}(data);
        if (!success) {
            assembly {
                revert(add(returnData, 32), mload(returnData))
            }
        }
    }

    function _sendNative(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool success,) = payable(to).call{value: amount}("");
        if (!success) revert NativeTransferFailed(to, amount);
    }

    function _forceApprove(address token, address spender, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.approve.selector, spender, amount)
        );
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert TokenCallFailed(token);
        }
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, amount)
        );
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert TokenCallFailed(token);
        }
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, amount)
        );
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert TokenCallFailed(token);
        }
    }
}