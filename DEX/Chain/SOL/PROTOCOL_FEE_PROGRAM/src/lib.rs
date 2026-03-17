use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, Transfer};

declare_id!("6r3qmoQA1mkZxB4mDXhtNUgwHSDjYzq9HxjYdRJtpA7X");

const CONFIG_SEED: &[u8] = b"config";
const VAULT_AUTHORITY_SEED: &[u8] = b"vault_authority";
const FEE_DENOMINATOR: u64 = 10_000;

#[program]
pub mod protocol_fee_program {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, fee_bps: u16, treasury: Pubkey) -> Result<()> {
        require!(fee_bps > 0 && fee_bps <= 100, ErrorCode::InvalidFeeBps);
        require!(treasury != Pubkey::default(), ErrorCode::InvalidTreasury);

        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.treasury = treasury;
        config.fee_bps = fee_bps;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn update_treasury(ctx: Context<UpdateTreasury>, treasury: Pubkey) -> Result<()> {
        require!(treasury != Pubkey::default(), ErrorCode::InvalidTreasury);
        ctx.accounts.config.treasury = treasury;
        Ok(())
    }

    pub fn update_admin(ctx: Context<UpdateAdmin>, new_admin: Pubkey) -> Result<()> {
        require!(new_admin != Pubkey::default(), ErrorCode::InvalidAdmin);
        ctx.accounts.config.admin = new_admin;
        Ok(())
    }

    pub fn settle_sell_wsol(
        ctx: Context<SettleSellWsol>,
        vault_seed: [u8; 8],
        min_net_out: u64,
    ) -> Result<()> {
        let config = &ctx.accounts.config;
        let gross_out = ctx.accounts.vault_wsol.amount;

        require!(gross_out > 0, ErrorCode::NoFundsReceived);

        let fee_amount = gross_out
            .checked_mul(config.fee_bps as u64)
            .ok_or(ErrorCode::MathOverflow)?
            / FEE_DENOMINATOR;
        let net_amount = gross_out
            .checked_sub(fee_amount)
            .ok_or(ErrorCode::MathOverflow)?;

        require!(net_amount >= min_net_out, ErrorCode::InsufficientNetOut);

        let authority_seeds: &[&[u8]] = &[
            VAULT_AUTHORITY_SEED,
            ctx.accounts.user.key.as_ref(),
            &vault_seed,
            &[ctx.bumps.vault_authority],
        ];
        let signer_seeds = &[authority_seeds];

        if fee_amount > 0 {
            let treasury_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_wsol.to_account_info(),
                    to: ctx.accounts.treasury_wsol.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
                signer_seeds,
            );
            token::transfer(treasury_ctx, fee_amount)?;
        }

        if net_amount > 0 {
            let user_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_wsol.to_account_info(),
                    to: ctx.accounts.user_wsol.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
                signer_seeds,
            );
            token::transfer(user_ctx, net_amount)?;
        }

        let close_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.vault_wsol.to_account_info(),
                destination: ctx.accounts.user.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            signer_seeds,
        );
        token::close_account(close_ctx)?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + FeeConfig::LEN,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, FeeConfig>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateTreasury<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, FeeConfig>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateAdmin<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, FeeConfig>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(vault_seed: [u8; 8], min_net_out: u64)]
pub struct SettleSellWsol<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, FeeConfig>,
    /// CHECK: PDA authority used only as a signer seed for the vault account.
    #[account(seeds = [VAULT_AUTHORITY_SEED, user.key().as_ref(), &vault_seed], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(
        mut,
        token::mint = native_mint,
        token::authority = vault_authority,
    )]
    pub vault_wsol: Account<'info, TokenAccount>,
    #[account(address = anchor_spl::token::spl_token::native_mint::id())]
    pub native_mint: Account<'info, Mint>,
    #[account(
        mut,
        constraint = user_wsol.owner == user.key() @ ErrorCode::InvalidUserDestination,
        constraint = user_wsol.mint == native_mint.key() @ ErrorCode::InvalidMint,
    )]
    pub user_wsol: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = treasury_wsol.owner == config.treasury @ ErrorCode::InvalidTreasuryDestination,
        constraint = treasury_wsol.mint == native_mint.key() @ ErrorCode::InvalidMint,
    )]
    pub treasury_wsol: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct FeeConfig {
    pub admin: Pubkey,
    pub treasury: Pubkey,
    pub fee_bps: u16,
    pub bump: u8,
}

impl FeeConfig {
    pub const LEN: usize = 32 + 32 + 2 + 1;
}

#[error_code]
pub enum ErrorCode {
    #[msg("Fee bps must be between 1 and 100.")]
    InvalidFeeBps,
    #[msg("Treasury address is invalid.")]
    InvalidTreasury,
    #[msg("Admin address is invalid.")]
    InvalidAdmin,
    #[msg("No WSOL was received from the swap.")]
    NoFundsReceived,
    #[msg("Arithmetic overflow.")]
    MathOverflow,
    #[msg("Net output is below the required minimum.")]
    InsufficientNetOut,
    #[msg("User WSOL destination is invalid.")]
    InvalidUserDestination,
    #[msg("Treasury WSOL destination is invalid.")]
    InvalidTreasuryDestination,
    #[msg("Token mint must be the native mint.")]
    InvalidMint,
}