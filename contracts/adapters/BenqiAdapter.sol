// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IYieldAdapter.sol";

/// @dev Minimal Benqi qiToken (cToken model) interface
interface IQiToken {
    function mint(uint256 mintAmount) external returns (uint256);
    function redeem(uint256 redeemTokens) external returns (uint256);
    function balanceOf(address owner) external view returns (uint256);
    function balanceOfUnderlying(address owner) external returns (uint256);
    function supplyRatePerTimestamp() external view returns (uint256);
}

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title BenqiAdapter
/// @notice Adapter wrapping Benqi qiUSDC on Avalanche Fuji testnet.
///         Uses cToken mint/redeem model. APY from supplyRatePerTimestamp.
contract BenqiAdapter is IYieldAdapter {

    uint256 private constant SECONDS_PER_YEAR = 31_536_000;

    address  public immutable vault;
    IQiToken public immutable qiUsdc;
    IERC20   public immutable usdc;

    /// @param _vault   YieldVault address
    /// @param _qiUsdc  Benqi qiUSDC (mainnet: 0xBEb5d47A3f720Ec0a390d04b4d41ED7d9688bC7F — no Fuji deployment)
    /// @param _usdc    Circle USDC on Fuji: 0x5425890298aed601595a70AB815c96711a31Bc65
    constructor(address _vault, address _qiUsdc, address _usdc) {
        require(_vault  != address(0), "BenqiAdapter: zero vault");
        require(_qiUsdc != address(0), "BenqiAdapter: zero qiUsdc");
        require(_usdc   != address(0), "BenqiAdapter: zero usdc");
        vault  = _vault;
        qiUsdc = IQiToken(_qiUsdc);
        usdc   = IERC20(_usdc);
    }

    modifier onlyVault() {
        require(msg.sender == vault, "BenqiAdapter: caller is not vault");
        _;
    }

    /// @inheritdoc IYieldAdapter
    function deposit(uint256 amount) external override onlyVault {
        usdc.transferFrom(msg.sender, address(this), amount);
        usdc.approve(address(qiUsdc), amount);
        uint256 result = qiUsdc.mint(amount);
        require(result == 0, "BenqiAdapter: mint failed");
    }

    /// @inheritdoc IYieldAdapter
    /// @dev Full redemption — redeems all qiTokens then transfers all USDC to vault.
    function withdraw(uint256 amount) external override onlyVault {
        uint256 qiBalance = qiUsdc.balanceOf(address(this));
        require(qiBalance > 0, "BenqiAdapter: no qiTokens to redeem");
        uint256 result = qiUsdc.redeem(qiBalance);
        require(result == 0, "BenqiAdapter: redeem failed");
        uint256 usdcBalance = usdc.balanceOf(address(this));
        require(usdcBalance >= amount, "BenqiAdapter: insufficient after redeem");
        usdc.transfer(msg.sender, usdcBalance);
    }

    /// @inheritdoc IYieldAdapter
    /// @dev supplyRatePerTimestamp is per-second, scaled by 1e18.
    ///      APY_bps = (ratePerSecond * SECONDS_PER_YEAR * 10000) / 1e18
    function getAPY() external view override returns (uint256) {
        try qiUsdc.supplyRatePerTimestamp() returns (uint256 ratePerSecond) {
            return (ratePerSecond * SECONDS_PER_YEAR * 10_000) / 1e18;
        } catch {
            return 0;
        }
    }

    /// @inheritdoc IYieldAdapter
    function getBalance() external view override returns (uint256) {
        return qiUsdc.balanceOf(address(this));
    }

    /// @inheritdoc IYieldAdapter
    function protocolName() external pure override returns (string memory) {
        return "Benqi";
    }
}
