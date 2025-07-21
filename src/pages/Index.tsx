import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Zap, TrendingUp, DollarSign, Clock, Activity } from "lucide-react";
import axios from "axios";
const Index = () => {
  const [walletAddress, setWalletAddress] = useState("");
  const [showResults, setShowResults] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  /**
 * Complete Gas Cost Calculator Function
 * Calculates total gas costs for an Ethereum address with historical USD pricing
 * 
 * @param {string} address - Ethereum wallet address
 * @param {string} apiKey - Alchemy API key
 * @param {function} onProgress - Optional callback for progress updates
 * @returns {Promise<Object>} Gas cost analysis results
 */
  const calculateGasCosts = async (address, apiKey, onProgress = null) => {
    const NETWORK = 'eth-mainnet';
    const HISTORY_API_URL = `https://api.g.alchemy.com/data/v1/${apiKey}/transactions/history/by-address`;
    const PRICES_API_URL = `https://api.g.alchemy.com/prices/v1/${apiKey}/tokens/historical`;

    /**
     * Fetch transaction history for the given address using pagination
     */
    async function fetchTransactionHistory(address) {
      let transactions = [];
      let hasMore = true;
      let cursor = undefined; // Renamed variable
      let page = 1;

      while (hasMore) {
        // Prepare the request payload with a limit (max 50)
        const data = {
          addresses: [{ address, networks: [NETWORK] }],
          limit: 50
        };
        // If a cursor was returned, include it in the next request as "after"
        if (cursor) {
          data.after = cursor;
        }

        console.log(`Fetching page ${page} with cursor: ${cursor || "none"}`);

        try {
          const response = await axios.post(HISTORY_API_URL, data);

          // Destructure the transactions array and the "after" cursor from the response.
          const { transactions: txs, after } = response.data;

          if (txs && Array.isArray(txs) && txs.length > 0) {
            transactions = transactions.concat(txs);
            if (after) {
              cursor = after;
              page++;
            } else {
              hasMore = false;
            }
          } else {
            hasMore = false;
          }
        } catch (error) {
          console.error("Error fetching transaction history:", error.response?.data || error.message);
          throw error;
        }
      }
      console.log(`Total transactions fetched: ${transactions.length}`);
      return transactions;
    }

    /**
     * Fetch historical ETH price for a given timestamp
     */
    const fetchHistoricalETHPrice = async (timestamp) => {
      const startDate = new Date(Number(timestamp));
      const endDate = new Date(Number(timestamp) + 3600000); // +1 hour
      const startTime = startDate.toISOString();
      const endTime = endDate.toISOString();

      const body = {
        symbol: "ETH",
        startTime: startTime,
        endTime: endTime,
        interval: "1h"
      };

      try {
        const response = await fetch(PRICES_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body)
        });

        if (!response.ok) {
          console.warn(`Failed to fetch price for ${startTime}: ${response.status}`);
          return null;
        }

        const responseData = await response.json();

        if (
          responseData &&
          responseData.data &&
          Array.isArray(responseData.data) &&
          responseData.data.length > 0
        ) {
          const priceObj = responseData.data[0];
          return parseFloat(priceObj.value);
        }

        return null;
      } catch (error) {
        console.warn(`Error fetching historical ETH price: ${error.message}`);
        return null;
      }
    };

    /**
     * Main calculation function
     */
    const calculateTotalGasCost = async (address) => {
      if (onProgress) {
        onProgress("Starting gas cost analysis...");
      }

      const transactions = await fetchTransactionHistory(address);

      if (transactions.length === 0) {
        throw new Error("No transactions found for this address");
      }

      let totalGasCostWei = 0n;
      let totalGasCostETH = 0.0;
      let totalGasCostUSD = 0.0;
      let txCosts = [];
      let lastValidPrice = null;
      let processedCount = 0;

      if (onProgress) {
        onProgress("Processing transactions and fetching historical prices...");
      }

      for (const tx of transactions) {
        processedCount++;
        console.log(`Processing transaction ${processedCount}/${transactions.length}: ${tx.hash}`);
        if (onProgress && processedCount % 10 === 0) {
          onProgress(`Processing transaction ${processedCount} of ${transactions.length}...`);
        }
        console.log(`Transaction hash: ${tx.hash}`);
        const gasUsedValue = tx.gasUsed || tx.gas;
        if (!gasUsedValue) {
          console.warn(`Transaction ${tx.hash} missing gasUsed/gas, skipping.`);
          continue;
        }
        console.log(`Gas used: ${gasUsedValue}`);
        const gasPriceValue = tx.effectiveGasPrice || tx.gasPrice;
        if (!gasPriceValue) {
          console.warn(`Transaction ${tx.hash} missing effectiveGasPrice/gasPrice, skipping.`);
          continue;
        }
        console.log(`Gas price: ${gasPriceValue}`);
        try {
          const gasUsedBig = BigInt(gasUsedValue);
          const gasPriceBig = BigInt(gasPriceValue);
          const txCostWei = gasUsedBig * gasPriceBig;

          // Convert Wei to ETH (1 ETH = 10^18 Wei)
          const txCostETH = parseFloat(txCostWei.toString()) / Math.pow(10, 18);

          if (!tx.blockTimestamp) {
            console.warn(`Transaction ${tx.hash} missing blockTimestamp, skipping historical price lookup.`);
            continue;
          }

          // Fetch historical price with retry logic
          console.log(`Fetching historical price for transaction ${tx.hash} at timestamp ${tx.blockTimestamp}`);
          let histPriceUSD = await fetchHistoricalETHPrice(tx.blockTimestamp);
          if (!histPriceUSD) {
            console.warn(`Historical price not found for transaction ${tx.hash} at timestamp ${tx.blockTimestamp}`);
          }
          if (histPriceUSD === null) {
            if (lastValidPrice !== null) {
              histPriceUSD = lastValidPrice;
              console.warn(`Using last valid historical price for transaction ${tx.hash}`);
            } else {
              console.warn(`Skipping transaction ${tx.hash} due to missing historical price and no prior price available.`);
              continue;
            }
          } else {
            lastValidPrice = histPriceUSD;
          }

          const txCostUSD = txCostETH * histPriceUSD;

          totalGasCostWei += txCostWei;
          totalGasCostETH += txCostETH;
          totalGasCostUSD += txCostUSD;

          txCosts.push({
            hash: tx.hash,
            timestamp: tx.blockTimestamp,
            costETH: txCostETH,
            costUSD: txCostUSD,
            gasUsed: gasUsedValue,
            gasPrice: gasPriceValue,
            ethPrice: histPriceUSD
          });

          // Small delay to avoid rate limiting
          if (processedCount % 20 === 0) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }

        } catch (error) {
          console.error(`Error processing transaction ${tx.hash}:`, error.message);
        }
      }

      if (onProgress) {
        onProgress("Finalizing calculations...");
      }

      // Calculate additional statistics
      const costs = txCosts.map(tx => tx.costUSD);
      const mostExpensive = costs.length > 0 ? Math.max(...costs) : 0;
      const avgCost = costs.length > 0 ? costs.reduce((a, b) => a + b, 0) / costs.length : 0;

      const timestamps = txCosts.map(tx => Number(tx.timestamp));
      const oldestTimestamp = timestamps.length > 0 ? Math.min(...timestamps) : 0;
      const newestTimestamp = timestamps.length > 0 ? Math.max(...timestamps) : 0;
      const timeRange = timestamps.length > 0 ?
        Math.ceil((newestTimestamp - oldestTimestamp) / (1000 * 60 * 60 * 24)) : 0;

      return {
        success: true,
        totalGasCostWei: totalGasCostWei.toString(),
        totalGasCostETH: totalGasCostETH.toString(),
        totalGasCostUSD: totalGasCostUSD.toFixed(2),
        transactionCosts: txCosts.sort((a, b) => Number(b.timestamp) - Number(a.timestamp)), // Sort by newest first
        statistics: {
          totalTransactions: txCosts.length,
          mostExpensive: mostExpensive,
          averageCost: avgCost,
          timeRange: timeRange,
          oldestTransaction: oldestTimestamp,
          newestTransaction: newestTimestamp
        }
      };
    };

    // Validate inputs
    if (!address || typeof address !== 'string') {
      throw new Error("Valid Ethereum address is required");
    }

    if (!apiKey || typeof apiKey !== 'string') {
      throw new Error("Valid Alchemy API key is required");
    }

    // Execute calculation
    try {
      const result = await calculateTotalGasCost(address);

      if (onProgress) {
        onProgress("✅ Analysis complete!");
      }
      console.log("Gas cost analysis result:", result);
      setShowResults(true);
      setResult(result);
      setError("");
      setIsCalculating(false);
      return result;
    } catch (error) {
      if (onProgress) {
        onProgress(`❌ Error: ${error.message}`);
      }
      throw error;
    }
  };

  /**
   * Usage Example:
   * 
   * const handleCalculate = async () => {
   *   try {
   *     setLoading(true);
   *     const result = await calculateGasCosts(
   *       walletAddress, 
   *       "your-alchemy-api-key",
   *       (progress) => setProgressMessage(progress)
   *     );
   *     setResult(result);
   *   } catch (error) {
   *     setError(error.message);xs
   *   } finally {
   *     setLoading(false);
   *   }
   * };
   */
  const stats = result?.statistics || null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-900 to-green-900 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-green-500/10 via-transparent to-blue-500/10 opacity-30"></div>
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-green-400/10 rounded-full blur-3xl"></div>
      <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-green-500/10 rounded-full blur-2xl"></div>

      <div className="relative z-10 container mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <div className="flex items-center justify-center mb-6">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-gradient-to-r from-green-400 to-green-600 rounded-lg flex items-center justify-center shadow-lg shadow-green-500/30">
                <Zap className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-white to-green-400 bg-clip-text text-transparent">
                Gas Tracker Pro
              </h1>
            </div>
          </div>
          <p className="text-xl text-gray-300 max-w-2xl mx-auto">
            Advanced Ethereum gas cost analysis with historical USD pricing
          </p>
        </div>

        <div className="max-w-2xl mx-auto mb-8">
          <Card className="bg-white/10 backdrop-blur-sm border-white/20 shadow-xl">
            <CardHeader>
              <CardTitle className="text-center text-white">Wallet Analysis</CardTitle>
              <CardDescription className="text-center text-gray-300">
                Enter an Ethereum wallet address to analyze total gas costs with historical USD values
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-white">Wallet Address</label>
                <Input
                  placeholder="0x742d35Cc6434C0532925a3b8D6aC6B4fb00c8D18"
                  value={walletAddress}
                  onChange={(e) => setWalletAddress(e.target.value)}
                  className="bg-white/10 border-white/20 text-white placeholder:text-gray-400 focus:border-green-400 focus:ring-green-400/20"
                />
              </div>

              <Button
                onClick={() => calculateGasCosts(walletAddress, "exekK53YRdHz42FMiwI6rkoIN45VTY7u")}
                disabled={!walletAddress.trim() || isCalculating}
                className="w-full bg-gradient-to-r from-green-400 to-green-600 hover:from-green-500 hover:to-green-700 hover:shadow-lg hover:shadow-green-500/30 transition-all duration-300 font-semibold text-white"
              >
                {isCalculating ? (
                  <div className="flex items-center space-x-2">
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                    <span>Analyzing Transactions...</span>
                  </div>
                ) : (
                  <>
                    <Activity className="w-4 h-4 mr-2" />
                    Calculate Gas Usage
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="max-w-4xl mx-auto mb-12">
          <Card className="bg-white/5 backdrop-blur-sm border-white/10">
            <CardHeader>
              <CardTitle className="text-center text-white">How It Works</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-3 gap-6">
                <div className="text-center space-y-3">
                  <div className="w-12 h-12 bg-green-400/20 rounded-lg flex items-center justify-center mx-auto">
                    <TrendingUp className="w-6 h-6 text-green-400" />
                  </div>
                  <h3 className="font-semibold text-white">Fetch Transaction History</h3>
                  <p className="text-sm text-gray-300">
                    Retrieves complete transaction history using Alchemy's Transaction History API with pagination
                  </p>
                </div>

                <div className="text-center space-y-3">
                  <div className="w-12 h-12 bg-green-400/20 rounded-lg flex items-center justify-center mx-auto">
                    <DollarSign className="w-6 h-6 text-green-400" />
                  </div>
                  <h3 className="font-semibold text-white">Calculate Historical Costs</h3>
                  <p className="text-sm text-gray-300">
                    Uses Historical Token Prices API to get accurate ETH prices at each transaction timestamp
                  </p>
                </div>

                <div className="text-center space-y-3">
                  <div className="w-12 h-12 bg-green-400/20 rounded-lg flex items-center justify-center mx-auto">
                    <Activity className="w-6 h-6 text-green-400" />
                  </div>
                  <h3 className="font-semibold text-white">Generate Analytics</h3>
                  <p className="text-sm text-gray-300">
                    Provides comprehensive breakdown with Wei, ETH, and USD calculations for every transaction
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {error && (
          <div className="max-w-2xl mx-auto mb-8">
            <Card className="bg-red-500/10 backdrop-blur-sm border-red-500/30">
              <CardContent className="pt-6">
                <p className="text-red-400 text-center font-medium">{error}</p>
              </CardContent>
            </Card>
          </div>
        )}

        {showResults && result && (
          <div className="max-w-4xl mx-auto animate-fadeIn">
            <Card className="bg-white/10 backdrop-blur-sm border-green-400/30 shadow-xl shadow-green-500/20">
              <CardHeader>
                <CardTitle className="text-center text-white flex items-center justify-center space-x-2">
                  <Zap className="w-5 h-5 text-green-400" />
                  <span>Complete Gas Cost Analysis</span>
                </CardTitle>
                <CardDescription className="text-center text-gray-300">
                  Historical gas costs calculated with real-time ETH pricing
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
                  <div className="bg-white/5 rounded-lg p-6 border border-white/10">
                    <div className="flex items-center space-x-2 mb-3">
                      <Activity className="w-5 h-5 text-green-400" />
                      <span className="text-sm font-medium text-gray-300">Total Transactions</span>
                    </div>
                    <p className="text-3xl font-bold text-white">
                      {result.transactionCosts ? result.transactionCosts.length.toLocaleString() : 0}
                    </p>
                  </div>

                  <div className="bg-white/5 rounded-lg p-6 border border-white/10">
                    <div className="flex items-center space-x-2 mb-3">
                      <Zap className="w-5 h-5 text-green-400" />
                      <span className="text-sm font-medium text-gray-300">Total Gas Cost (ETH)</span>
                    </div>
                    <p className="text-2xl font-bold text-white">
                      {parseFloat(result.totalGasCostETH).toFixed(6)} ETH
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      {BigInt(result.totalGasCostWei).toLocaleString()} wei
                    </p>
                  </div>

                  <div className="bg-gradient-to-r from-green-500/20 to-green-600/20 rounded-lg p-6 border border-green-400/30">
                    <div className="flex items-center space-x-2 mb-3">
                      <DollarSign className="w-5 h-5 text-green-400" />
                      <span className="text-sm font-medium text-green-200">Total Cost (USD)</span>
                    </div>
                    <p className="text-3xl font-bold text-green-400">
                      ${parseFloat(result.totalGasCostUSD).toLocaleString()}
                    </p>
                  </div>

                  {stats && (
                    <>
                      <div className="bg-white/5 rounded-lg p-6 border border-white/10">
                        <div className="flex items-center space-x-2 mb-3">
                          <TrendingUp className="w-5 h-5 text-green-400" />
                          <span className="text-sm font-medium text-gray-300">Average Cost</span>
                        </div>
                        <p className="text-2xl font-bold text-white">{stats.avgCost}</p>
                        <p className="text-xs text-gray-400 mt-1">per transaction</p>
                      </div>

                      <div className="bg-white/5 rounded-lg p-6 border border-white/10">
                        <div className="flex items-center space-x-2 mb-3">
                          <Activity className="w-5 h-5 text-orange-400" />
                          <span className="text-sm font-medium text-gray-300">Most Expensive TX</span>
                        </div>
                        <p className="text-2xl font-bold text-orange-400">{stats.mostExpensive}</p>
                        <p className="text-xs text-gray-400 mt-1">single transaction</p>
                      </div>

                      <div className="bg-white/5 rounded-lg p-6 border border-white/10">
                        <div className="flex items-center space-x-2 mb-3">
                          <Clock className="w-5 h-5 text-blue-400" />
                          <span className="text-sm font-medium text-gray-300">Analysis Period</span>
                        </div>
                        <p className="text-2xl font-bold text-blue-400">{stats.timeRange}</p>
                        <p className="text-xs text-gray-400 mt-1">transaction history</p>
                      </div>
                    </>
                  )}
                </div>

                {result.transactionCosts && result.transactionCosts.length > 0 && (
                  <div className="bg-white/5 rounded-lg p-6 border border-white/10">
                    <h3 className="text-lg font-semibold text-white mb-4 flex items-center">
                      <Activity className="w-5 h-5 text-green-400 mr-2" />
                      Recent Transactions Sample
                    </h3>
                    <div className="space-y-3 max-h-64 overflow-y-auto">
                      {result.transactionCosts.slice(0, 10).map((tx, index) => (
                        <div key={index} className="flex items-center justify-between bg-white/5 rounded-lg p-3">
                          <div className="flex-1">
                            <p className="text-sm text-gray-300 font-mono">
                              {tx.hash.substring(0, 10)}...{tx.hash.substring(tx.hash.length - 8)}
                            </p>
                            <p className="text-xs text-gray-500">
                              {new Date(Number(tx.timestamp)).toLocaleDateString()}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold text-white">
                              {tx.costETH.toFixed(6)} ETH
                            </p>
                            <p className="text-xs text-green-400">
                              ${tx.costUSD.toFixed(2)}
                            </p>
                          </div>
                        </div>
                      ))}
                      {result.transactionCosts.length > 10 && (
                        <p className="text-center text-xs text-gray-500 pt-2">
                          Showing 10 of {result.transactionCosts.length.toLocaleString()} transactions
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        <div className="text-center mt-16 text-gray-400">
          <p className="text-sm">
            Powered by{" "}
            <span className="text-green-400 font-medium">Alchemy's Transaction History API</span>
            {" "}and{" "}
            <span className="text-green-400 font-medium">Historical Token Prices API</span>
          </p>
          <p className="text-xs mt-2 text-gray-500">
            Real-time gas cost analysis with historical USD pricing accuracy
          </p>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn {
          animation: fadeIn 0.6s ease-out;
        }
      `}</style>
    </div>
  );
};

export default Index;