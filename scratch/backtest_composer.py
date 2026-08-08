import yfinance as yf
import pandas as pd
import numpy as np
import warnings
warnings.filterwarnings('ignore')

def calculate_rsi(data, periods=14):
    delta = data.diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=periods).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=periods).mean()
    rs = gain / loss
    rsi = 100 - (100 / (1 + rs))
    return rsi

def main():
    print("Fetching data...")
    tickers = ['AGG', 'BIL', 'TLT', 'UUP', 'SOXL', 'TQQQ', 'UPRO', 'TECL', 'QID', 'TBF', 'UGL', 'TMF', 'BTAL', 'XLP']
    
    # Start in 2014 to ensure all ETFs existed and have enough history
    data = yf.download(tickers, start='2014-01-01', end='2026-08-08', progress=False)['Close']
    
    # Forward fill missing data
    data = data.ffill().dropna()
    
    # Calculate returns
    daily_returns = data.pct_change()
    
    # Calculate indicators
    agg_60d_ret = data['AGG'].pct_change(60)
    bil_60d_ret = data['BIL'].pct_change(60)
    
    tlt_20d_ret = data['TLT'].pct_change(20)
    bil_20d_ret = data['BIL'].pct_change(20)
    
    rsi_10 = pd.DataFrame()
    for col in ['SOXL', 'TQQQ', 'UPRO', 'TECL']:
        rsi_10[col] = calculate_rsi(data[col], 10)
        
    rsi_20 = pd.DataFrame()
    for col in ['QID', 'TBF']:
        rsi_20[col] = calculate_rsi(data[col], 20)
        
    print("Running backtest...")
    portfolio_value = [10000]
    dates = []
    
    # Start simulating after all indicators are populated
    start_idx = 60
    
    for i in range(start_idx, len(data) - 1):
        date = data.index[i]
        
        # State at close of day i determines portfolio for day i+1
        is_risk_on = agg_60d_ret.iloc[i] > bil_60d_ret.iloc[i]
        is_risk_off_rising = tlt_20d_ret.iloc[i] < bil_20d_ret.iloc[i]
        
        allocations = {ticker: 0.0 for ticker in tickers}
        
        if is_risk_on:
            # Risk On: Invest evenly in the two with the lowest 10-day RSI
            today_rsi_10 = rsi_10.iloc[i]
            lowest_two = today_rsi_10.nsmallest(2).index
            allocations[lowest_two[0]] = 0.5
            allocations[lowest_two[1]] = 0.5
        elif is_risk_off_rising:
            # Risk Off, rising interest rates: 50% UUP, 50% lowest 20-day RSI in [QID, TBF]
            today_rsi_20 = rsi_20.iloc[i]
            lowest_one = today_rsi_20.nsmallest(1).index[0]
            allocations['UUP'] = 0.5
            allocations[lowest_one] = 0.5
        else:
            # Risk Off, falling interest rates
            allocations['UGL'] = 0.25
            allocations['TMF'] = 0.25
            allocations['BTAL'] = 0.25
            allocations['XLP'] = 0.25
            
        # Calculate next day's return
        next_day_returns = daily_returns.iloc[i+1]
        
        daily_pnl = 0
        for ticker, weight in allocations.items():
            if weight > 0:
                daily_pnl += weight * next_day_returns[ticker]
                
        # Rebalance daily - no transaction costs included for simplicity
        new_value = portfolio_value[-1] * (1 + daily_pnl)
        portfolio_value.append(new_value)
        dates.append(data.index[i+1])

    # Convert to dataframe
    results = pd.DataFrame({'Date': dates, 'Portfolio Value': portfolio_value[1:]})
    results.set_index('Date', inplace=True)
    
    total_return = (results['Portfolio Value'].iloc[-1] / 10000) - 1
    annualized_return = (1 + total_return) ** (252 / len(results)) - 1
    
    # Max Drawdown
    roll_max = results['Portfolio Value'].cummax()
    drawdown = results['Portfolio Value'] / roll_max - 1.0
    max_drawdown = drawdown.min()
    
    # Sharpe (assuming 0 risk free rate for simplicity)
    daily_rets = results['Portfolio Value'].pct_change().dropna()
    sharpe = np.sqrt(252) * (daily_rets.mean() / daily_rets.std())
    
    # SPY benchmark
    spy = yf.download('SPY', start=results.index[0], end=results.index[-1], progress=False)['Close']
    if isinstance(spy, pd.DataFrame):
        spy = spy['SPY'] # handle multi-index yfinance output change
    spy_ret = (spy.iloc[-1] / spy.iloc[0]) - 1
    spy_ann = (1 + spy_ret) ** (252 / len(spy)) - 1
    
    print("=" * 40)
    print("BACKTEST RESULTS (2014 - Present)")
    print("=" * 40)
    print(f"Initial Capital: $10,000")
    print(f"Final Capital:   ${results['Portfolio Value'].iloc[-1]:,.2f}")
    print(f"Total Return:    {total_return * 100:.2f}%")
    print(f"CAGR:            {annualized_return * 100:.2f}%")
    print(f"Max Drawdown:    {max_drawdown * 100:.2f}%")
    print(f"Sharpe Ratio:    {sharpe:.2f}")
    print("-" * 40)
    print(f"SPY Benchmark CAGR: {spy_ann * 100:.2f}%")
    print("=" * 40)

if __name__ == "__main__":
    main()
