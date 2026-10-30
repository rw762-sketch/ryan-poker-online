import { simulateEquity, seededRandom } from './poker-math.js?v=45157f8cabbe';
import { analyzeDecision } from './strategy.js?v=45157f8cabbe';
self.onmessage = ({ data }) => {
  try {
    // Random seed is generated once per requested calculation, not from live game state.
    const simulation = simulateEquity(data.input, data.trials, seededRandom(data.seed));
    const advice = analyzeDecision(data.input, simulation);
    self.postMessage({ simulation, advice });
  } catch (error) { self.postMessage({ error:error.message }); }
};
