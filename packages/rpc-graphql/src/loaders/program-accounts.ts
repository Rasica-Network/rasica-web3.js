/* eslint-disable @typescript-eslint/no-explicit-any */
import { Address } from '@solana/addresses';
import {
    DataSlice,
    GetProgramAccountsDatasizeFilter,
    GetProgramAccountsMemcmpFilter,
    Slot,
    SolanaRpcMethods,
} from '@solana/rpc-core';
import { Commitment } from '@solana/rpc-types';
import DataLoader from 'dataloader';
import { GraphQLResolveInfo } from 'graphql';

import type { Rpc } from '../context';
import { cacheKeyFn } from './common/cache-key-fn';
import { onlyPresentFieldRequested } from './common/resolve-info';

export type ProgramAccountsLoaderArgs = {
    programAddress: Address;
    commitment?: Commitment;
    dataSlice?: DataSlice;
    encoding?: 'base58' | 'base64' | 'base64+zstd' | 'jsonParsed';
    filters: (GetProgramAccountsMemcmpFilter | GetProgramAccountsDatasizeFilter)[];
    minContextSlot?: Slot;
};

/* Normalizes RPC optional configs to use GraphQL API defaults */
function normalizeArgs({
    commitment = 'confirmed',
    dataSlice,
    encoding = 'jsonParsed',
    filters,
    minContextSlot,
    programAddress,
}: ProgramAccountsLoaderArgs) {
    return { commitment, dataSlice, encoding, filters, minContextSlot, programAddress };
}

/* Load a program's accounts from the RPC, transform them, then return them */
async function loadProgramAccounts(rpc: Rpc, { programAddress, ...config }: ReturnType<typeof normalizeArgs>) {
    const programAccounts = await rpc
        .getProgramAccounts(programAddress, config as Parameters<SolanaRpcMethods['getProgramAccounts']>[1])
        .send()
        .then(res => {
            if ('value' in res) {
                return res.value as ReturnType<SolanaRpcMethods['getProgramAccounts']>;
            }
            return res as ReturnType<SolanaRpcMethods['getProgramAccounts']>;
        })
        .catch(e => {
            throw e;
        });

    return programAccounts.map(programAccount => ({
        ...programAccount.account,
        address: programAccount.pubkey,
    }));
}

function createProgramAccountsBatchLoadFn(rpc: Rpc) {
    const resolveProgramAccountsUsingRpc = loadProgramAccounts.bind(null, rpc);
    return async (programAccountsQueryArgs: readonly ReturnType<typeof normalizeArgs>[]) => {
        return await Promise.all(
            programAccountsQueryArgs.map(async args => await resolveProgramAccountsUsingRpc(args)),
        );
    };
}

export function createProgramAccountsLoader(rpc: Rpc) {
    const loader = new DataLoader(createProgramAccountsBatchLoadFn(rpc), { cacheKeyFn });
    return {
        load: async (args: ProgramAccountsLoaderArgs, info?: GraphQLResolveInfo) => {
            if (onlyPresentFieldRequested('programAddress', info)) {
                // If a user only requests the program's address,
                // don't call the RPC or the cache
                return { programAddress: args.programAddress };
            }
            return loader.load(normalizeArgs(args));
        },
    };
}
