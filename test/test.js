const assert = require('assert');
const {NetworkMetaAnalysis, fixedEffectsOddsRatioNMA, fixedEffectsMeanDifferenceNMA} = require('../../shukra');
const { Matrix, inverse } = require('ml-matrix');

describe('NMA Holder Class', function() {
    const trt = new Matrix([[0, 5], [-5, 0]]);
    const se = new Matrix([[0,2], [2,0]]);
    const trtLabel = ['Band-aid', 'Stitch'];
    const meanDiffNMA = new NetworkMetaAnalysis(trt, se, trtLabel);

    it('should echo treatment effect', function() {
        assert.strictEqual(meanDiffNMA.getEffect('Band-aid', 'Stitch'), 5);
        assert.strictEqual(meanDiffNMA.getEffect('Stitch', 'Band-aid'), -5);
    });

    const inferentialStats = meanDiffNMA.computeInferentialStatistics('Band-aid', 'Stitch', .95);

    it('should compute inferential statistics', function() {
        // determined via the following r code:
        // 2 * pnorm(0, 5, 2)
        assert.ok(inferentialStats.p > .0124 && inferentialStats.p < .0125);
        // qnorm(.975, 5, 2)
        assert.ok(inferentialStats.upperBound > 8.91 && inferentialStats.upperBound < 8.92);
        // qnorm(.025, 5, 2)
        assert.ok(inferentialStats.lowerBound > 1.08 && inferentialStats.lowerBound < 1.09);
    });

    it('should complain if you ask for a non-existent treatment', function() {
        assert.throws(() => meanDiffNMA.getEffect("Super glue", "Stitch"));
        assert.throws(() =>
            meanDiffNMA.computeInferentialStatistics("Stitch", "Super glue", .95));
    });
});

