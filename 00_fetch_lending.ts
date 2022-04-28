import { publicKey, u8, u64, u128, struct, bool } from "@project-serum/borsh"
import { PublicKey } from "@solana/web3.js"
import TULIP_TOKENS from "@tulip-protocol/platform-sdk/constants/lending_info.json"
import Decimal from "decimal.js"

import { Connection } from "@solana/web3.js"
import _ from "lodash"
import { TokenListProvider, Strategy } from '@solana/spl-token-registry';


const LENDING_RESERVES = TULIP_TOKENS.lending.reserves
const DURATION = { DAILY: 144, WEEKLY: 1008, YEARLY: 52560 }
const WEI_TO_UNITS = 1_000_000_000_000_000_000

const LENDING_RESERVE_LAYOUT = struct([
    u8("version"),
    struct([u64("slot"), bool("stale")], "lastUpdateSlot"),

    publicKey("lendingMarket"),
    publicKey("borrowAuthorizer"),

    struct(
        [
            publicKey("mintPubKey"),
            u8("mintDecimals"),
            publicKey("supplyPubKey"),
            publicKey("feeReceiver"),
            publicKey("oraclePubKey"),
            u64("availableAmount"),
            u128("borrowedAmount"),
            u128("cumulativeBorrowRate"),
            u128("marketPrice"),
            u128("platformAmountWads"),
            u8("platformFees")
        ],
        "liquidity"
    )
])

let TOKEN_LIST: any[] = []
const tokenList = async () => {
    if (!TOKEN_LIST.length) {
        const tokens = await new TokenListProvider().resolve(Strategy.Static);
        TOKEN_LIST = tokens.filterByClusterSlug("mainnet-beta").getList();
    }
    return TOKEN_LIST;
}

const findTokenByMint = async (mint: any) => {
    if (!mint) {
      return
    }
    const tokens = await tokenList()
  
    return tokens.find((token) => {
        try {
            return (new PublicKey(token.address)).equals(new PublicKey(mint))
        } catch (e) {
            console.log(new PublicKey(token.address), mint);
        }
    });
}

type ArrayWithEmpties<T> = (T | undefined | null | false)[]
function compact<T>(arr: ArrayWithEmpties<T>): T[] {
    return arr.filter((x) => Boolean(x)) as T[]
}

const calculateBorrowAPR = (
    utilization: Decimal,
    isRaydium: boolean,
    isOther: boolean
) => {
    const rate = utilization.times(100);
    const i = isRaydium ? 35 : 25;

    if (rate.lte(50)) return rate.div(50).times(15);

    if (rate.gt(50) && rate.lte(90)) return rate
        .minus(50)
        .div(40)
        .times(i - 15)
        .plus(15);

    if (rate.gt(90)) return rate
        .minus(90)
        .div(10)
        .times((isOther ? 150 : 100) - i)
        .plus(i);
}

const compound = (amount: Decimal, timeframe: number) => {
    const a = amount.div(DURATION.DAILY);

    return a.div(100).plus(1).pow(timeframe).minus(1).times(100)
}

async function fetch(
    connection = new Connection("https://solana-api.projectserum.com", "confirmed")
): Promise<any> {
    const reserves = await Promise.all(
        _.map(LENDING_RESERVES, async (reserve) => {
            const token = await findTokenByMint(reserve.liquidity_supply_token_mint)

            if (!token) return

            return new PublicKey(reserve.account)
        })
    );

    const infos = await connection.getMultipleAccountsInfo(compact(reserves))

    const rates = await Promise.all(
        _.map(infos, async (info, i) => {
            const reservePubKey = reserves[i]

            if (!info || !reservePubKey) return

            const reserve = LENDING_RESERVES.find((r) =>
                (new PublicKey(r.account)).equals(reservePubKey)
            )

            const token = await findTokenByMint(reserve?.liquidity_supply_token_mint)

            if (!token || !reserve) return

            const data = LENDING_RESERVE_LAYOUT.decode(info.data)
            const decimals = new Decimal(10).pow(token.decimals)

            const availableAmount = new Decimal(
                data.liquidity.availableAmount.toString()
            ).div(decimals)

            const platformAmountWads = new Decimal(
                data.liquidity.platformAmountWads.toString()
            ).div(WEI_TO_UNITS).div(decimals)

            const borrowedAmount = new Decimal(
                data.liquidity.borrowedAmount.toString()
            ).div(WEI_TO_UNITS).div(decimals)

            const remainingAmount = availableAmount
                .plus(borrowedAmount)
                .minus(platformAmountWads)

            const utilizedAmount = borrowedAmount.gt(remainingAmount)
                ? remainingAmount
                : borrowedAmount

            const utilization = utilizedAmount.div(remainingAmount)

            const borrowAPR = calculateBorrowAPR(
                utilization,
                "RAY" === reserve.name,
                "ORCA" === reserve.name ||
                    "whETH" === reserve.name ||
                    "mSOL" === reserve.name ||
                    "BTC" === reserve.name ||
                    "GENE" === reserve.name ||
                    "SAMO" === reserve.name ||
                    "DFL" === reserve.name ||
                    "CAVE" === reserve.name ||
                    "REAL" === reserve.name ||
                    "wbWBNB" === reserve.name ||
                    "MBS" === reserve.name ||
                    "SHDW" === reserve.name ||
                    "BASIS" === reserve.name
                )

            if (!borrowAPR) return

            const dailyBorrowRate = borrowAPR.div(365)
            const dailyLendingRate = utilization.times(dailyBorrowRate)
            const borrowAPY = compound(dailyBorrowRate, DURATION.YEARLY).div(100)
            const lendAPY = compound(dailyLendingRate, DURATION.YEARLY).div(100)

            return {
                symbol: token.symbol,
                // mint: new PublicKey(token.address),
                apy: lendAPY,
                // borrowApy: borrowAPY,
                tvl: availableAmount.plus(utilizedAmount),
                utilization: utilizedAmount.div(availableAmount.plus(utilizedAmount))
            }
        })
    )

    return {
        protocol: "tulip",
        lending: compact(rates)
    }
}

(async () => {
    try {
        const data = await fetch();
        console.log(data);
    } catch (e) {
        console.log(e);
    }
})();