"""
Portfolio Risk & Allocation Analysis: FAANG Stocks (2020 - 2023)
================================================================
Modern Portfolio Theory (MPT) / Mean-Variance Optimization (Markowitz)

Author: Portfolio Project
Objective:
    1. Benchmark (Equally Weighted): Compute expected return and annualized Sharpe ratio (rf = 0%).
    2. Minimum Volatility: Find the asset allocation that minimizes portfolio risk.
    3. Maximum Sharpe Ratio: Find the tangency portfolio that maximizes risk-adjusted returns (rf = 0%).
"""

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from pypfopt import expected_returns, risk_models
from pypfopt.efficient_frontier import EfficientFrontier


def run_portfolio_analysis(csv_path: str = "faang_stocks.csv"):
    # ---------------------------------------------------------
    # 1. Data Loading and Preparation
    # ---------------------------------------------------------
    stock_prices_df = pd.read_csv(csv_path, index_col="Date")
    stock_prices_df.index = pd.to_datetime(stock_prices_df.index)

    tickers = stock_prices_df.columns.tolist()
    n_assets = len(tickers)

    # ---------------------------------------------------------
    # 2. Annualized Expected Returns and Sample Covariance Matrix
    # ---------------------------------------------------------
    # mu: annualized expected returns (arithmetic mean, compounding=False)
    # S: annualized sample covariance matrix (252 trading days)
    mu = expected_returns.mean_historical_return(stock_prices_df, compounding=False)
    S = risk_models.sample_cov(stock_prices_df)

    # ---------------------------------------------------------
    # 3. Question 1: Benchmark Portfolio (Equally Weighted - 1/N)
    # ---------------------------------------------------------
    # Standard benchmark calculation using daily returns and 252 trading days:
    daily_returns = stock_prices_df.pct_change().dropna()
    benchmark_returns = daily_returns.mean(axis=1)  # Equal weights (1/5 per stock)

    # Expected return of the equally weighted portfolio (daily mean)
    benchmark_exp_return: float = float(benchmark_returns.mean())

    # Annualized volatility of the benchmark portfolio
    benchmark_vol: float = float(benchmark_returns.std() * np.sqrt(252))

    # Annualized Sharpe Ratio (risk-free rate Rf = 0%)
    benchmark_sharpe_ratio: float = float((benchmark_exp_return / benchmark_returns.std()) * np.sqrt(252))

    # For academic comparison via PyPortfolioOpt (CAGR / geometric mean):
    equal_weights = {ticker: 1.0 / n_assets for ticker in tickers}
    ef_benchmark = EfficientFrontier(mu, S)
    ef_benchmark.set_weights(equal_weights)
    bench_perf_cagr = ef_benchmark.portfolio_performance(verbose=False, risk_free_rate=0.0)
    bench_cagr_ret: float = float(bench_perf_cagr[0])
    bench_cagr_sharpe: float = float(bench_perf_cagr[2])

    # ---------------------------------------------------------
    # 4. Question 2: Minimum Volatility Portfolio
    # ---------------------------------------------------------
    ef_mv = EfficientFrontier(mu, S)
    ef_mv.min_volatility()
    mv_weights_dict = ef_mv.clean_weights()

    mv_portfolio: pd.Series = pd.Series(mv_weights_dict)
    mv_perf = ef_mv.portfolio_performance(verbose=False, risk_free_rate=0.0)
    mv_portfolio_vol: float = float(mv_perf[1])

    # ---------------------------------------------------------
    # 5. Question 3: Maximum Sharpe Ratio Portfolio (Tangency)
    # ---------------------------------------------------------
    ef_ms = EfficientFrontier(mu, S)
    ef_ms.max_sharpe(risk_free_rate=0.0)
    ms_weights_dict = ef_ms.clean_weights()

    ms_portfolio: pd.Series = pd.Series(ms_weights_dict)
    ms_perf = ef_ms.portfolio_performance(verbose=False, risk_free_rate=0.0)
    ms_portfolio_sharpe: float = float(ms_perf[2])

    # ---------------------------------------------------------
    # 6. Summary & Comparative Results Table
    # ---------------------------------------------------------
    summary_df = pd.DataFrame(
        {
            "Expected Return (p.a.)": [
                f"{benchmark_exp_return:.2%}",
                f"{mv_perf[0]:.2%}",
                f"{ms_perf[0]:.2%}",
            ],
            "Volatility (p.a.)": [
                f"{benchmark_vol:.2%}",
                f"{mv_portfolio_vol:.2%}",
                f"{ms_perf[1]:.2%}",
            ],
            "Sharpe Ratio (Rf=0%)": [
                f"{benchmark_sharpe_ratio:.4f}",
                f"{mv_perf[2]:.4f}",
                f"{ms_portfolio_sharpe:.4f}",
            ],
        },
        index=["Benchmark (Equal Weight)", "Minimum Volatility", "Maximum Sharpe"],
    )

    weights_comparison_df = pd.DataFrame(
        {
            "Benchmark (1/N)": pd.Series(equal_weights),
            "Min Volatility": mv_portfolio,
            "Max Sharpe": ms_portfolio,
        }
    )

    print("=" * 65)
    print("PORTFOLIO SUMMARY - MEAN-VARIANCE OPTIMIZATION (MARKOWITZ)")
    print("=" * 65)
    print(summary_df)
    print("\n" + "=" * 65)
    print("ASSET ALLOCATION WEIGHTS (%)")
    print("=" * 65)
    print((weights_comparison_df * 100).round(2).astype(str) + "%")

    # ---------------------------------------------------------
    # 7. Professional Portfolio Visualizations
    # ---------------------------------------------------------
    plt.style.use("seaborn-v0_8-whitegrid" if "seaborn-v0_8-whitegrid" in plt.style.available else "default")

    # Chart 1: Efficient Frontier with Monte Carlo Simulation
    np.random.seed(42)
    n_simulations = 5000
    sim_returns = []
    sim_volatilities = []
    sim_sharpes = []

    for _ in range(n_simulations):
        w = np.random.random(n_assets)
        w /= np.sum(w)
        r = np.dot(w, mu)
        vol = np.sqrt(np.dot(w.T, np.dot(S, w)))
        sim_returns.append(r)
        sim_volatilities.append(vol)
        sim_sharpes.append(r / vol)

    fig, ax = plt.subplots(figsize=(10, 6))
    scatter = ax.scatter(
        sim_volatilities,
        sim_returns,
        c=sim_sharpes,
        cmap="viridis",
        marker="o",
        s=12,
        alpha=0.35,
        label="Random Simulations",
    )
    plt.colorbar(scatter, label="Sharpe Ratio (Rf = 0%)")

    # Highlight Optimal Portfolios
    ax.scatter(
        benchmark_vol,
        benchmark_exp_return,
        color="royalblue",
        marker="s",
        s=150,
        edgecolor="black",
        linewidth=1.5,
        label=f"Benchmark (Equal Weight): Ret={benchmark_exp_return:.1%}, Vol={benchmark_vol:.1%}",
    )
    ax.scatter(
        mv_portfolio_vol,
        mv_perf[0],
        color="forestgreen",
        marker="^",
        s=180,
        edgecolor="black",
        linewidth=1.5,
        label=f"Minimum Volatility: Vol={mv_portfolio_vol:.1%}, Ret={mv_perf[0]:.1%}",
    )
    ax.scatter(
        ms_perf[1],
        ms_perf[0],
        color="crimson",
        marker="*",
        s=260,
        edgecolor="black",
        linewidth=1.5,
        label=f"Maximum Sharpe: Sharpe={ms_portfolio_sharpe:.2f}, Ret={ms_perf[0]:.1%}",
    )

    # Plot Individual Assets
    for ticker in tickers:
        asset_vol = np.sqrt(S.loc[ticker, ticker])
        asset_ret = mu[ticker]
        ax.scatter(asset_vol, asset_ret, color="dimgray", s=60)
        ax.annotate(
            ticker,
            (asset_vol, asset_ret),
            xytext=(6, 4),
            textcoords="offset points",
            fontweight="bold",
            fontsize=10,
        )

    ax.set_title("Markowitz Efficient Frontier & Optimal Allocations (FAANG 2020-2023)", fontsize=13, fontweight="bold")
    ax.set_xlabel("Annualized Volatility (Risk $\\sigma$)", fontsize=11)
    ax.set_ylabel("Annualized Expected Return ($E[R]$)", fontsize=11)
    ax.legend(loc="upper left", frameon=True, framealpha=0.9)
    plt.tight_layout()
    plt.savefig("efficient_frontier.png", dpi=300)
    plt.close()

    # Chart 2: Asset Allocation Comparison
    fig, ax = plt.subplots(figsize=(9, 5))
    weights_comparison_df.plot(kind="bar", ax=ax, width=0.8, colormap="tab10")
    ax.set_title("Asset Allocation Comparison by Strategy", fontsize=13, fontweight="bold")
    ax.set_ylabel("Portfolio Weight (0.0 to 1.0)", fontsize=11)
    ax.set_xlabel("Assets (FAANG)", fontsize=11)
    ax.set_xticklabels(tickers, rotation=0, fontweight="bold")
    ax.set_ylim(0, 1.05)
    for p in ax.patches:
        height = p.get_height()
        if height > 0.03:
            ax.annotate(
                f"{height:.1%}",
                (p.get_x() + p.get_width() / 2.0, height + 0.015),
                ha="center",
                va="bottom",
                fontsize=8.5,
                rotation=0,
            )
    ax.legend(title="Strategy", frameon=True)
    plt.tight_layout()
    plt.savefig("portfolio_allocation_comparison.png", dpi=300)
    plt.close()

    print("\nCharts successfully saved: 'efficient_frontier.png' and 'portfolio_allocation_comparison.png'")

    return {
        "benchmark_exp_return": benchmark_exp_return,
        "benchmark_sharpe_ratio": benchmark_sharpe_ratio,
        "mv_portfolio_vol": mv_portfolio_vol,
        "mv_portfolio": mv_portfolio,
        "ms_portfolio_sharpe": ms_portfolio_sharpe,
        "ms_portfolio": ms_portfolio,
    }


if __name__ == "__main__":
    results = run_portfolio_analysis()
