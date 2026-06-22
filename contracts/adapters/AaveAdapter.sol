// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IYieldAdapter.sol";

/// @dev Minimal AAVE V3 Pool interface
interface IAaveV3Pool {
    function supply(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 referralCode
    ) external;

    function withdraw(
        address asset,
        uint256 amount,
        address to
    ) external returns (uint256);
}

/// @dev Minimal AAVE V3 PoolDataProvider interface — for APY reads
interface IAaveV3DataProvider {
    function getReserveData(address asset) external view returns (
        uint256 unbacked,
        uint256 accruedToTreasuryScaled,
        uint256 totalAToken,
        uint256 totalStableDebt,
        uint256 totalVariableDebt,
        uint256 liquidityRate,        // APY in RAY units (1e27)
        uint256 variableBorrowRate,
        uint256 stableBorrowRate,
        uint256 averageStableBorrowRate,
        uint256 liquidityIndex,
        uint256 variableBorrowIndex,
        uint40  lastUpdateTimestamp
    );
}

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title AaveAdapter
/// @notice Adapter wrapping AAVE V3 on Avalanche Fuji testnet.
///         Deposits USDC into AAVE supply position, receives aUSDC.
///         APY read from PoolDataProvider.getReserveData().liquidityRate.
contract AaveAdapter is IYieldAdapter {

    address   public immutable vault;
    IAaveV3Pool         public immutable aavePool;
    IAaveV3DataProvider public immutable dataProvider;
    IERC20    public immutable usdc;
    IERC20    public immutable aUsdc;

    /// @param _vault        YieldVault address
    /// @param _aavePool     AAVE V3 Pool on Fuji: 0x8B9b2AF4afB389b4a70A474dfD4AdCD4a302bb40
    /// @param _dataProvider AAVE V3 DataProvider on Fuji: 0xC65cbd1e309Bf0e841Ee6f6E786480598e6a4014
    /// @param _usdc         Circle USDC on Fuji: 0x5425890298aed601595a70AB815c96711a31Bc65
    /// @param _aUsdc        aUSDC on Fuji: 0x9CFcc1B289E59FBe1E769f020C77315DF8473760
    constructor(
        address _vault,
        address _aavePool,
        address _dataProvider,
        address _usdc,
        address _aUsdc
    ) {
        require(_vault        != address(0), "AaveAdapter: zero vault");
        require(_aavePool     != address(0), "AaveAdapter: zero pool");
        require(_dataProvider != address(0), "AaveAdapter: zero provider");
        require(_usdc         != address(0), "AaveAdapter: zero usdc");
        require(_aUsdc        != address(0), "AaveAdapter: zero ausdc");
        vault        = _vault;
        aavePool     = IAaveV3Pool(_aavePool);
        dataProvider = IAaveV3DataProvider(_dataProvider);
        usdc         = IERC20(_usdc);
        aUsdc        = IERC20(_aUsdc);
    }

    modifier onlyVault() {
        require(msg.sender == vault, "AaveAdapter: caller is not vault");
        _;
    }

    /// @inheritdoc IYieldAdapter
    function deposit(uint256 amount) external override onlyVault {
        usdc.transferFrom(msg.sender, address(this), amount);
        usdc.approve(address(aavePool), amount);
        aavePool.supply(address(usdc), amount, address(this), 0);
    }

    /// @inheritdoc IYieldAdapter
    function withdraw(uint256 amount) external override onlyVault {
        aavePool.withdraw(address(usdc), amount, msg.sender);
    }

    /// @inheritdoc IYieldAdapter
    /// @dev liquidityRate is in RAY = 1e27. Divide by 1e23 to convert to bps.
    ///      Example: 62000000000000000000000000 / 1e23 = 620 bps = 6.20%
    function getAPY() external view override returns (uint256) {
        try dataProvider.getReserveData(address(usdc)) returns (
            uint256, uint256, uint256, uint256, uint256,
            uint256 liquidityRate, uint256, uint256, uint256, uint256, uint256, uint40
        ) {
            return liquidityRate / 1e23;
        } catch {
            return 0;
        }
    }

    /// @inheritdoc IYieldAdapter
    function getBalance() external view override returns (uint256) {
        return aUsdc.balanceOf(address(this));
    }

    /// @inheritdoc IYieldAdapter
    function protocolName() external pure override returns (string memory) {
        return "AAVE V3";
    }
}
