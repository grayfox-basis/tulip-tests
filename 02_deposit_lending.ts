import { PublicKey, Connection, Keypair } from "@solana/web3.js";
import { depositToVault } from '@tulip-protocol/platform-sdk';

// Boilerplate setup for web3 connection
const endpoint = 'https://solana-api.projectserum.com';
const commitment = 'confirmed';
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

// Token Accounts in the user's wallet
const tokenAccounts: {[key: string]: any} = {};

async function sendSignedTransaction (connection: any, signedTransaction: any) {
    const rawTransaction = signedTransaction.serialize();
  
    const txid = await connection.sendRawTransaction(rawTransaction, {
      skipPreflight: true,
      preflightCommitment: commitment
    });
  
    return txid;
}

async function signTransaction (
    connection: any,
    wallet: any,
    transaction: any,
    signers: any = []
) {
    transaction.recentBlockhash = (await connection.getRecentBlockhash(commitment)).blockhash;
    transaction.setSigners(wallet.publicKey, ...signers.map((s: any) => s.publicKey));
  
    if (signers.length > 0) {
        transaction.partialSign(...signers);
    }
  
    return wallet.signTransaction(transaction);
}
 
async function sendTransaction (
    connection: any,
    wallet: any,
    transaction: any,
    signers: any = []
) {
    const signedTransaction = await signTransaction(connection,
      wallet,
      transaction,
      signers);
  
    return sendSignedTransaction(connection, signedTransaction);
}

// Set token accounts
(async () => {

    // Inputs taken by Tulip SDK's `depositToLendingReserve`
    const conn = new Connection(endpoint, { commitment });
    const DEMO_WALLET_SECRET_KEY = new Uint8Array([]); // POST YOUR DUMMY WALLET HERE
    var wallet = Keypair.fromSecretKey(DEMO_WALLET_SECRET_KEY);

    if (!wallet.publicKey) return

    // For example, this is the `mintAddress` of TULIP
    const farmMintAddress: string = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    conn.getParsedTokenAccountsByOwner(wallet.publicKey, { programId: TOKEN_PROGRAM_ID, }, commitment)
        .then((parsedTokenAccounts) => {
            parsedTokenAccounts.value.forEach((tokenAccountInfo) => {
                // `tokenAccountAddress` is same as `authorityTokenAccount`
                // (used in input to `depositToLendingReserve`)
                const tokenAccountAddress = tokenAccountInfo.pubkey.toBase58(),
                parsedInfo = tokenAccountInfo.account.data.parsed.info,
                mintAddress: string = parsedInfo.mint,
                balance = parsedInfo.tokenAmount.amount;
                console.log(balance)

                tokenAccounts[mintAddress] = {
                    tokenAccountAddress,
                    balance,
                };
            });
        });

    console.log(tokenAccounts);

    const depositToTulipProtocol = async () => {
        // For example, let's hardcode the `amount` to '0.01'
        const amountToDeposit = '10';
        const authorityTokenAccount = tokenAccounts[farmMintAddress].tokenAccountAddress;
    
        const transaction = await depositToVault(
            conn,
            wallet,
            farmMintAddress,
            authorityTokenAccount,
            amountToDeposit
        );
    
        // Let's assume this is how the function signature of
        // your custom `sendTransaction` looks like
        return sendTransaction(conn, wallet, transaction);
    };

    console.log(await depositToTulipProtocol())
})();