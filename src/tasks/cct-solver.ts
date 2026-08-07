import { NS } from "@ns";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import { getAllServers } from "/lib/network.js";

type SolverFn = (data: any) => any;

const SOLVERS: Record<string, SolverFn> = {
  "Find Largest Prime Factor": solveLargestPrimeFactor,
  "Subarray with Maximum Sum": solveMaxSubarraySum,
  "Array Jumping Game": solveArrayJumping,
  "Array Jumping Game II": solveArrayJumpingII,
  "Merge Overlapping Intervals": solveMergeIntervals,
  "Spiralize Matrix": solveSpiralizeMatrix,
  "Largest Rectangle in a Matrix": solveLargestRectangleInMatrix,
  "Algorithmic Stock Trader I": solveStockTraderI,
  "Algorithmic Stock Trader II": solveStockTraderII,
  "Algorithmic Stock Trader III": solveStockTraderIII,
  "Algorithmic Stock Trader IV": solveStockTraderIV,
  "Minimum Path Sum in a Grid": solveMinimumPathSum,
  "Minimum Path Sum in a Triangle": solveMinPathSumTriangle,
  "Unique Paths in a Grid I": solveUniquePathsI,
  "Unique Paths in a Grid II": solveUniquePathsII,
  "Shortest Path in a Grid": solveShortestPathInAGrid,
  "Encryption I: Caesar Cipher": solveCaesarCipher,
  "Encryption II: Vigenère Cipher": solveVigenereCipher,
  "Compression I: RLE Compression": solveCompressionI,
  "Compression II: LZ Decompression": solveCompressionII,
  "Compression III: LZ Compression": solveCompressionIII,
  "Proper 2-Coloring of a Graph": solveProper2Coloring,
  "Generate IP Addresses": solveGenerateIPAddresses,
  "Sanitize Parentheses in Expression": solveSanitizeParentheses,
  "Find All Valid Math Expressions": solveFindAllValidMathExpressions,
  "HammingCodes: Integer to Encoded Binary": solveHammingEncode,
  "HammingCodes: Encoded Binary to Integer": solveHammingDecode,
  "Total Ways to Sum": solveTotalWaysToSum,
  "Total Ways to Sum II": solveTotalWaysToSumII,
  "Square Root": solveSquareRoot,
  "Total Number of Primes": solveTotalNumberOfPrimes,
};

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  const flags = ns.flags([
    ["loop", false],
    ["interval", 30000],
  ]);

  const isLoop = flags.loop as boolean;
  const interval = flags.interval as number;

  const logger = new Logger(ns, "CCT-SOLVER", undefined, "DEBUG", 1, {}, ["cct", "solver"]);

  do {
    logger.time("cct-scan");
    const servers = getAllServers(ns);
    let foundCount = 0;
    let solvedCount = 0;
    let failedCount = 0;

    for (const server of servers) {
      const files = ns.ls(server, ".cct");

      for (const file of files) {
        foundCount++;
        const type = ns.codingcontract.getContractType(file, server);
        const data = ns.codingcontract.getData(file, server);
        const solver = SOLVERS[type];
        const targetLogger = logger.forTarget(server);

        if (solver) {
          try {
            const answer = solver(data);
            const reward = smartAttempt(ns, answer, file, server);

            if (reward) {
              targetLogger.success(
                `[${type}] Contract '${file}' erfolgreich gelöst! Belohnung: ${reward}`,
                server,
                { context: { contract: file, type, reward } }
              );
              solvedCount++;
            } else {
              targetLogger.error(
                `[${type}] Falsche Lösung für '${file}' übergeben!`,
                server,
                { context: { contract: file, type } }
              );
              failedCount++;
            }
          } catch (err: any) {
            targetLogger.error(
              `[${type}] Laufzeitfehler beim Lösen von '${file}': ${err?.message || err}`,
              server,
              { context: { contract: file, type } }
            );
            failedCount++;
          }
        } else {
          targetLogger.warn(
            `Kein Solver implementiert für Typ: "${type}" (${file}).`,
            server,
            { context: { contract: file, type } }
          );
        }
      }
    }

    const durationMs = logger.timeEnd("cct-scan", "DEBUG");

    if (foundCount > 0 || !isLoop) {
      logger.info(
        `Durchlauf beendet (${durationMs}ms). Gefunden: ${foundCount} | Gelöst: ${solvedCount} | Fehlgeschlagen: ${failedCount}`,
        undefined,
        { context: { foundCount, solvedCount, failedCount, durationMs } }
      );
    }

    if (isLoop) {
      await ns.sleep(interval);
    }
  } while (isLoop);
}

// ============================================================================
// SOLVER ALGORITHMEN
// ============================================================================

/**
 * Versucht die Lösung in allen gängigen Formaten (Zahl, Array, String, JSON) 
 * an Bitburner zu übergeben, um Format-Fehler automatisch zu umgehen.
 */
function smartAttempt(ns: NS, answer: any, file: string, server: string): string {
  if (answer === undefined || answer === null || (typeof answer === "number" && isNaN(answer))) {
    throw new Error(`Solver lieferte ein ungültiges Ergebnis (${answer})`);
  }

  const candidates: any[] = [];
  
  // Originalen Wert als ersten Kandidaten hinzufügen
  candidates.push(answer);

  if (Array.isArray(answer)) {
    if (answer.length === 1) candidates.push(answer[0]);
    candidates.push(answer.map(Number));
    candidates.push(answer.join(","));
    candidates.push(JSON.stringify(answer));
  } else {
    const num = Number(answer);
    if (!isNaN(num)) {
      candidates.push(num);
      candidates.push([num]);
    }
    candidates.push(String(answer));
    candidates.push([answer]);
    candidates.push(JSON.stringify(answer));
  }

  // Duplikate in den Kandidaten eliminieren
  const uniqueCandidates = Array.from(
    new Map(candidates.map(c => [typeof c === "object" ? JSON.stringify(c) : c, c])).values()
  );

  let lastError: any = null;

  for (const candidate of uniqueCandidates) {
    try {
      return ns.codingcontract.attempt(candidate, file, server);
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.includes("not in the right format")) {
        lastError = err;
        continue; // Nächstes Format testen
      }
      throw err; // Echten Systemfehler sofort werfen
    }
  }

  if (lastError) {
    throw lastError;
  }

  return "";
}
function solveLargestPrimeFactor(n: number): number {
  let divisor = 2;
  while (n > 1) {
    if (n % divisor === 0) {
      n /= divisor;
    } else {
      divisor++;
    }
  }
  return divisor;
}

function solveMaxSubarraySum(arr: number[]): number {
  let maxSoFar = arr[0];
  let maxEndingHere = arr[0];
  for (let i = 1; i < arr.length; i++) {
    maxEndingHere = Math.max(arr[i], maxEndingHere + arr[i]);
    maxSoFar = Math.max(maxSoFar, maxEndingHere);
  }
  return maxSoFar;
}

function solveArrayJumping(arr: number[]): number {
  let maxReach = 0;
  for (let i = 0; i < arr.length; i++) {
    if (i > maxReach) return 0;
    maxReach = Math.max(maxReach, i + arr[i]);
    if (maxReach >= arr.length - 1) return 1;
  }
  return 0;
}

function isValidParentheses(s: string): boolean {
  let count = 0;
  for (const char of s) {
    if (char === "(") count++;
    else if (char === ")") {
      count--;
      if (count < 0) return false;
    }
  }
  return count === 0;
}

function solveMergeIntervals(intervals: number[][]): number[][] {
  if (intervals.length === 0) return [];
  intervals.sort((a, b) => a[0] - b[0]);
  const merged: number[][] = [intervals[0]];

  for (let i = 1; i < intervals.length; i++) {
    const last = merged[merged.length - 1];
    const curr = intervals[i];
    if (curr[0] <= last[1]) {
      last[1] = Math.max(last[1], curr[1]);
    } else {
      merged.push(curr);
    }
  }
  return merged;
}

function solveSpiralizeMatrix(matrix: number[][]): number[] {
  const result: number[] = [];
  if (matrix.length === 0) return result;

  let top = 0;
  let bottom = matrix.length - 1;
  let left = 0;
  let right = matrix[0].length - 1;

  while (top <= bottom && left <= right) {
    for (let i = left; i <= right; i++) result.push(matrix[top][i]);
    top++;

    for (let i = top; i <= bottom; i++) result.push(matrix[i][right]);
    right--;

    if (top <= bottom) {
      for (let i = right; i >= left; i--) result.push(matrix[bottom][i]);
      bottom--;
    }

    if (left <= right) {
      for (let i = bottom; i >= top; i--) result.push(matrix[i][left]);
      left++;
    }
  }
  return result;
}

function solveStockTraderI(prices: number[]): number {
  let minPrice = Infinity;
  let maxProfit = 0;

  for (const price of prices) {
    minPrice = Math.min(minPrice, price);
    maxProfit = Math.max(maxProfit, price - minPrice);
  }
  return maxProfit;
}

function solveStockTraderII(prices: number[]): number {
  let profit = 0;
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] > prices[i - 1]) {
      profit += prices[i] - prices[i - 1];
    }
  }
  return profit;
}

function solveStockTraderIII(prices: number[]): number {
  let hold1 = -Infinity;
  let hold2 = -Infinity;
  let release1 = 0;
  let release2 = 0;

  for (const price of prices) {
    release2 = Math.max(release2, hold2 + price);
    hold2 = Math.max(hold2, release1 - price);
    release1 = Math.max(release1, hold1 + price);
    hold1 = Math.max(hold1, -price);
  }
  return release2;
}

function solveStockTraderIV(data: [number, number[]]): number {
  const k = data[0];
  const prices = data[1];

  if (prices.length === 0 || k === 0) return 0;

  if (k >= Math.floor(prices.length / 2)) {
    return solveStockTraderII(prices);
  }

  const buy = new Array(k + 1).fill(-Infinity);
  const sell = new Array(k + 1).fill(0);

  for (const price of prices) {
    for (let i = 1; i <= k; i++) {
      buy[i] = Math.max(buy[i], sell[i - 1] - price);
      sell[i] = Math.max(sell[i], buy[i] + price);
    }
  }
  return sell[k];
}

function solveMinimumPathSum(grid: number[][]): number {
  const rows = grid.length;
  const cols = grid[0].length;
  const dp: number[][] = Array.from({ length: rows }, () =>
    Array(cols).fill(0),
  );

  dp[0][0] = grid[0][0];

  for (let j = 1; j < cols; j++) {
    dp[0][j] = dp[0][j - 1] + grid[0][j];
  }
  for (let i = 1; i < rows; i++) {
    dp[i][0] = dp[i - 1][0] + grid[i][0];
  }

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      dp[i][j] = Math.min(dp[i - 1][j], dp[i][j - 1]) + grid[i][j];
    }
  }

  return dp[rows - 1][cols - 1];
}

function solveUniquePathsI(data: [number, number]): number {
  const [rows, cols] = data;
  const dp: number[][] = Array.from({ length: rows }, () =>
    Array(cols).fill(1),
  );

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      dp[i][j] = dp[i - 1][j] + dp[i][j - 1];
    }
  }

  return dp[rows - 1][cols - 1];
}

function solveUniquePathsII(grid: number[][]): number {
  const rows = grid.length;
  const cols = grid[0].length;

  if (grid[0][0] === 1 || grid[rows - 1][cols - 1] === 1) return 0;

  const dp: number[][] = Array.from({ length: rows }, () =>
    Array(cols).fill(0),
  );
  dp[0][0] = 1;

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      if (grid[i][j] === 1) {
        dp[i][j] = 0;
        continue;
      }
      if (i > 0) dp[i][j] += dp[i - 1][j];
      if (j > 0) dp[i][j] += dp[i][j - 1];
    }
  }

  return dp[rows - 1][cols - 1];
}

function solveShortestPathInAGrid(grid: number[][]): string {
  const rows = grid.length;
  const cols = grid[0].length;

  if (grid[0][0] === 1 || grid[rows - 1][cols - 1] === 1) return "";

  const queue: [number, number, string][] = [[0, 0, ""]];
  const visited: boolean[][] = Array.from({ length: rows }, () =>
    Array(cols).fill(false),
  );
  visited[0][0] = true;

  const dirs: [number, number, string][] = [
    [1, 0, "D"],
    [0, 1, "R"],
    [-1, 0, "U"],
    [0, -1, "L"],
  ];

  while (queue.length > 0) {
    const [r, c, path] = queue.shift()!;

    if (r === rows - 1 && c === cols - 1) return path;

    for (const [dr, dc, move] of dirs) {
      const nr = r + dr;
      const nc = c + dc;

      if (
        nr >= 0 &&
        nr < rows &&
        nc >= 0 &&
        nc < cols &&
        grid[nr][nc] === 0 &&
        !visited[nr][nc]
      ) {
        visited[nr][nc] = true;
        queue.push([nr, nc, path + move]);
      }
    }
  }

  return "";
}

function solveCaesarCipher(data: [string, number]): string {
  const [plain, shift] = data;
  let result = "";

  for (let i = 0; i < plain.length; i++) {
    const charCode = plain.charCodeAt(i);
    if (charCode >= 65 && charCode <= 90) {
      const shifted = ((charCode - 65 - shift + 2600) % 26) + 65;
      result += String.fromCharCode(shifted);
    } else {
      result += plain[i];
    }
  }
  return result;
}

function solveVigenereCipher(data: [string, string]): string {
  const [plain, key] = data;
  let result = "";

  for (let i = 0; i < plain.length; i++) {
    const pCode = plain.charCodeAt(i) - 65;
    const kCode = key.charCodeAt(i % key.length) - 65;
    const shifted = ((pCode + kCode) % 26) + 65;
    result += String.fromCharCode(shifted);
  }
  return result;
}

function solveCompressionI(plain: string): string {
  let result = "";
  let i = 0;

  while (i < plain.length) {
    let runLen = 1;
    while (
      i + runLen < plain.length &&
      plain[i + runLen] === plain[i] &&
      runLen < 9
    ) {
      runLen++;
    }
    result += `${runLen}${plain[i]}`;
    i += runLen;
  }
  return result;
}

function solveCompressionII(encoded: string): string {
  let i = 0;
  let result = "";

  while (i < encoded.length) {
    const litLen = parseInt(encoded[i++], 10);
    if (litLen > 0) {
      result += encoded.substring(i, i + litLen);
      i += litLen;
    }
    if (i >= encoded.length) break;

    const backLen = parseInt(encoded[i++], 10);
    if (backLen > 0) {
      const backOffset = parseInt(encoded[i++], 10);
      for (let j = 0; j < backLen; j++) {
        result += result[result.length - backOffset];
      }
    }
  }
  return result;
}

function solveCompressionIII(plain: string): string {
  const n = plain.length;
  const dp: (string | null)[] = new Array(n + 1).fill(null);
  dp[n] = "";

  for (let i = n - 1; i >= 0; i--) {
    let best: string | null = null;

    for (let L1 = 1; L1 <= 9 && i + L1 <= n; L1++) {
      const literals = plain.substring(i, i + L1);
      const nextI = i + L1;

      if (nextI === n) {
        const candidate = `${L1}${literals}`;
        if (best === null || candidate.length < best.length) best = candidate;
      } else {
        for (let L2 = 1; L2 <= 9 && nextI + L2 <= n; L2++) {
          for (let offset = 1; offset <= 9 && nextI - offset >= 0; offset++) {
            let match = true;
            for (let k = 0; k < L2; k++) {
              if (plain[nextI + k] !== plain[nextI - offset + k]) {
                match = false;
                break;
              }
            }
            if (match) {
              const rest = dp[nextI + L2];
              if (rest !== null) {
                const candidate = `${L1}${literals}${L2}${offset}` + rest;
                if (best === null || candidate.length < best.length)
                  best = candidate;
              }
            }
          }
        }

        const rest = dp[nextI];
        if (rest !== null) {
          const candidate = `${L1}${literals}0` + rest;
          if (best === null || candidate.length < best.length) best = candidate;
        }
      }
    }

    if (i > 0) {
      for (let L2 = 1; L2 <= 9 && i + L2 <= n; L2++) {
        for (let offset = 1; offset <= 9 && i - offset >= 0; offset++) {
          let match = true;
          for (let k = 0; k < L2; k++) {
            if (plain[i + k] !== plain[i - offset + k]) {
              match = false;
              break;
            }
          }
          if (match) {
            const rest = dp[i + L2];
            if (rest !== null) {
              const candidate = `0${L2}${offset}` + rest;
              if (best === null || candidate.length < best.length)
                best = candidate;
            }
          }
        }
      }
    }

    dp[i] = best;
  }

  return dp[0] || "";
}

function solveProper2Coloring(data: [number, [number, number][]]): number[] {
  const [numNodes, edges] = data;
  const adj: number[][] = Array.from({ length: numNodes }, () => []);

  for (const [u, v] of edges) {
    adj[u].push(v);
    adj[v].push(u);
  }

  const colors: number[] = new Array(numNodes).fill(-1);

  for (let i = 0; i < numNodes; i++) {
    if (colors[i] !== -1) continue;

    colors[i] = 0;
    const queue: number[] = [i];

    while (queue.length > 0) {
      const curr = queue.shift()!;
      for (const neighbor of adj[curr]) {
        if (colors[neighbor] === -1) {
          colors[neighbor] = 1 - colors[curr];
          queue.push(neighbor);
        } else if (colors[neighbor] === colors[curr]) {
          return [];
        }
      }
    }
  }

  return colors;
}

function solveGenerateIPAddresses(s: string): string[] {
  const result: string[] = [];
  const len = s.length;
  if (len < 4 || len > 12) return result;

  for (let a = 1; a <= 3; a++) {
    for (let b = 1; b <= 3; b++) {
      for (let c = 1; c <= 3; c++) {
        const d = len - a - b - c;
        if (d >= 1 && d <= 3) {
          const p1 = s.substring(0, a);
          const p2 = s.substring(a, a + b);
          const p3 = s.substring(a + b, a + b + c);
          const p4 = s.substring(a + b + c);

          if (
            isValidOctet(p1) &&
            isValidOctet(p2) &&
            isValidOctet(p3) &&
            isValidOctet(p4)
          ) {
            result.push(`${p1}.${p2}.${p3}.${p4}`);
          }
        }
      }
    }
  }
  return result;
}

function isValidOctet(segment: string): boolean {
  if (segment.length > 1 && segment.startsWith("0")) return false;
  const num = parseInt(segment, 10);
  return num >= 0 && num <= 255;
}

function solveHammingEncode(n: number): string {
  const dataBits = n.toString(2).split("").map(Number);
  const k = dataBits.length;

  let m = 0;
  while (1 << m < k + m + 1) {
    m++;
  }

  const totalLen = k + m + 1;
  const bits: number[] = new Array(totalLen).fill(0);

  let dataIdx = 0;
  for (let i = 1; i < totalLen; i++) {
    if ((i & (i - 1)) !== 0) {
      bits[i] = dataBits[dataIdx++];
    }
  }

  for (let i = 0; i < m; i++) {
    const pVal = 1 << i;
    let parity = 0;
    for (let j = 1; j < totalLen; j++) {
      if ((j & pVal) !== 0) {
        parity ^= bits[j];
      }
    }
    bits[pVal] = parity;
  }

  let totalParity = 0;
  for (let i = 1; i < totalLen; i++) {
    totalParity ^= bits[i];
  }
  bits[0] = totalParity;

  return bits.join("");
}

function solveHammingDecode(data: string): number {
  const bits = data.split("").map(Number);
  let errPos = 0;

  for (let i = 1; i < bits.length; i++) {
    if (bits[i] === 1) {
      errPos ^= i;
    }
  }

  if (errPos > 0 && errPos < bits.length) {
    bits[errPos] ^= 1;
  }

  let dataStr = "";
  for (let i = 1; i < bits.length; i++) {
    if ((i & (i - 1)) !== 0) {
      dataStr += bits[i];
    }
  }

  return parseInt(dataStr, 2) || 0;
}

// ----------------------------------------------------------------------------
// MATHEMATIK & PARTITIONIERUNG
// ----------------------------------------------------------------------------

function solveTotalWaysToSum(n: number): number {
  const dp: number[] = new Array(n + 1).fill(0);
  dp[0] = 1;

  for (let i = 1; i < n; i++) {
    for (let j = i; j <= n; j++) {
      dp[j] += dp[j - i];
    }
  }

  return dp[n];
}

function solveTotalWaysToSumII(data: [number, number[]]): number {
  const [n, set] = data;
  const dp: number[] = new Array(n + 1).fill(0);
  dp[0] = 1;

  for (const coin of set) {
    for (let i = coin; i <= n; i++) {
      dp[i] += dp[i - coin];
    }
  }

  return dp[n];
}

// 1. Find All Valid Math Expressions
function solveFindAllValidMathExpressions(data: [string, number]): string[] {
  const [num, target] = data;
  const result: string[] = [];

  function dfs(
    index: number,
    prevOperand: number,
    currentVal: number,
    expression: string,
  ) {
    if (index === num.length) {
      if (currentVal === target) result.push(expression);
      return;
    }

    for (let i = index; i < num.length; i++) {
      if (i !== index && num[index] === "0") break; // Führende Nullen verhindern

      const subStr = num.slice(index, i + 1);
      const val = parseInt(subStr, 10);

      if (index === 0) {
        dfs(i + 1, val, val, subStr);
      } else {
        dfs(i + 1, val, currentVal + val, `${expression}+${subStr}`);
        dfs(i + 1, -val, currentVal - val, `${expression}-${subStr}`);
        dfs(
          i + 1,
          prevOperand * val,
          currentVal - prevOperand + prevOperand * val,
          `${expression}*${subStr}`,
        );
      }
    }
  }

  dfs(0, 0, 0, "");
  return result;
}

// 2. Array Jumping Game II
function solveArrayJumpingII(data: number[]): number {
  const n = data.length;
  if (n <= 1) return 0;

  let jumps = 0;
  let currentEnd = 0;
  let farthest = 0;

  for (let i = 0; i < n - 1; i++) {
    farthest = Math.max(farthest, i + data[i]);
    if (i === currentEnd) {
      jumps++;
      currentEnd = farthest;
      if (currentEnd >= n - 1) break;
    }
  }

  return currentEnd >= n - 1 ? jumps : 0;
}

// 3. Minimum Path Sum in a Triangle
function solveMinPathSumTriangle(triangle: number[][]): number {
  if (!triangle.length) return 0;
  const dp = [...triangle[triangle.length - 1]];

  for (let r = triangle.length - 2; r >= 0; r--) {
    for (let c = 0; c <= r; c++) {
      dp[c] = triangle[r][c] + Math.min(dp[c], dp[c + 1]);
    }
  }

  return dp[0];
}

// 4. Square Root
function solveSquareRoot(data: number | string | bigint): string {
  let n: bigint;
  try {
    if (typeof data === "bigint") {
      n = data;
    } else if (typeof data === "number") {
      n = BigInt(Math.floor(data));
    } else {
      const str = String(data).trim();
      if (str.includes("e") || str.includes("E")) {
        n = BigInt(Math.floor(Number(str)));
      } else {
        n = BigInt(str);
      }
    }
  } catch {
    return "0";
  }

  if (n <= 0n) return "0";
  if (n === 1n) return "1";

  const bitLength = BigInt(n.toString(2).length);
  let x0 = 1n << ((bitLength + 1n) >> 1n);

  while (true) {
    const x1 = (x0 + n / x0) >> 1n;
    if (x1 >= x0) {
      return x0.toString();
    }
    x0 = x1;
  }
}

// 5. Total Number of Primes
function solveTotalNumberOfPrimes(data: number | string): number {
  const n = typeof data === "number" ? data : parseInt(data, 10);
  if (n <= 2) return 0;

  const max = n - 1;
  const isPrime = new Uint8Array(max + 1).fill(1);
  isPrime[0] = 0;
  isPrime[1] = 0;

  for (let p = 2; p * p <= max; p++) {
    if (isPrime[p]) {
      for (let i = p * p; i <= max; i += p) {
        isPrime[i] = 0;
      }
    }
  }

  let count = 0;
  for (let i = 2; i <= max; i++) {
    if (isPrime[i]) count++;
  }

  return count;
}

// 6. Sanitize Parentheses in Expression
function solveSanitizeParentheses(data: string): string[] {
  const isValid = (str: string): boolean => {
    let count = 0;
    for (const ch of str) {
      if (ch === "(") count++;
      else if (ch === ")") {
        count--;
        if (count < 0) return false;
      }
    }
    return count === 0;
  };

  const queue: string[] = [data];
  const visited = new Set<string>([data]);
  const result: string[] = [];
  let found = false;

  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (isValid(curr)) {
      result.push(curr);
      found = true;
    }

    if (found) continue;

    for (let i = 0; i < curr.length; i++) {
      if (curr[i] !== "(" && curr[i] !== ")") continue;
      const next = curr.slice(0, i) + curr.slice(i + 1);
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }

  return result.length > 0 ? result : [""];
}

/**
 * 7. Largest Rectangle in a Matrix
 * Ermittelt die größte Rechteckfläche aus 1en in einer binären Matrix.
 */
function solveLargestRectangleInMatrix(data: any): number {
  let matrix: number[][] = data;

  if (typeof data === "string") {
    try {
      matrix = JSON.parse(data);
    } catch {
      return 0;
    }
  }

  if (!Array.isArray(matrix) || matrix.length === 0 || !Array.isArray(matrix[0])) {
    return 0;
  }

  const rows = matrix.length;
  const cols = matrix[0].length;
  const heights: number[] = new Array(cols).fill(0);
  let maxArea = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const val = Number(matrix[r]?.[c]);
      heights[c] = val === 1 ? heights[c] + 1 : 0;
    }

    const stack: number[] = [];
    for (let i = 0; i <= cols; i++) {
      const h = i === cols ? 0 : heights[i];
      while (stack.length > 0 && heights[stack[stack.length - 1]] >= h) {
        const topIdx = stack.pop();
        if (topIdx === undefined) break;

        const height = heights[topIdx];
        const width = stack.length === 0 ? i : i - stack[stack.length - 1] - 1;
        const area = height * width;

        if (!isNaN(area) && isFinite(area)) {
          maxArea = Math.max(maxArea, area);
        }
      }
      stack.push(i);
    }
  }

  return maxArea;
}