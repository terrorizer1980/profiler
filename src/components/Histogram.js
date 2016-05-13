import React, { Component, PropTypes } from 'react';
import shallowCompare from 'react-addons-shallow-compare';
import { timeCode } from '../time-code';

class Histogram extends Component {

  constructor(props) {
    super(props);
    this._resizeListener = () => this.forceUpdate();
    this._requestedAnimationFrame = false;
  }

  _scheduleDraw() {
    if (!this._requestedAnimationFrame) {
      this._requestedAnimationFrame = true;
      window.requestAnimationFrame(() => {
        this._requestedAnimationFrame = false;
        if (this.refs.canvas) {
          timeCode('histogram render', () => {
            this.drawCanvas(this.refs.canvas);
          });
        }
      });
    }
  }

  shouldComponentUpdate(nextProps, nextState) {
    return shallowCompare(this, nextProps, nextState);
  }

  componentDidMount() {
    const win = this.refs.canvas.ownerDocument.defaultView;
    win.addEventListener('resize', this._resizeListener);
    this.forceUpdate(); // for initial size
  }

  componentWillUnmount() {
    const win = this.refs.canvas.ownerDocument.defaultView;
    win.removeEventListener('resize', this._resizeListener);
  }

  drawCanvas(c) {
    const { thread, interval, rangeStart, rangeEnd, funcStackInfo, selectedFuncStack } = this.props;

    const devicePixelRatio = c.ownerDocument ? c.ownerDocument.defaultView.devicePixelRatio : 1;
    const r = c.getBoundingClientRect();
    c.width = Math.round(r.width * devicePixelRatio);
    c.height = Math.round(r.height * devicePixelRatio);
    const ctx = c.getContext('2d');
    let maxDepth = 0;
    const { funcStackTable, sampleFuncStacks } = funcStackInfo;
    for (let i = 0; i < funcStackTable.depth.length; i++) {
      if (funcStackTable.depth[i] > maxDepth) {
        maxDepth = funcStackTable.depth[i];
      }
    }
    const range = [rangeStart, rangeEnd];
    const rangeLength = range[1] - range[0];
    const xPixelsPerMs = c.width / rangeLength;
    const yPixelsPerDepth = c.height / maxDepth;
    const intervalMs = interval * 1.5;
    let selectedFuncStackDepth = 0;
    if (selectedFuncStack !== -1 && selectedFuncStack !== null) {
      selectedFuncStackDepth = funcStackTable.depth[selectedFuncStack];
    }
    function hasSelectedFuncStackPrefix(funcStack) {
      let depth = funcStackTable.depth[funcStack];
      while (depth > selectedFuncStackDepth) {
        funcStack = funcStackTable.prefix[funcStack];
        depth--;
      }
      return funcStack === selectedFuncStack;
    }
    for (let i = 0; i < sampleFuncStacks.length; i++) {
      const sampleTime = thread.samples.time[i];
      if (sampleTime + intervalMs < range[0] || sampleTime > range[1])
        continue;
      const funcStack = sampleFuncStacks[i];
      const isHighlighted = hasSelectedFuncStackPrefix(funcStack);
      const sampleHeight = funcStackTable.depth[funcStack] * yPixelsPerDepth;
      const startY = c.height - sampleHeight;
      // const responsiveness = thread.samples.responsiveness[i];
      // const jankSeverity = Math.min(1, responsiveness / 100);
      ctx.fillStyle = isHighlighted ? '#38445f' : '#7990c8';
      ctx.fillRect((sampleTime - range[0]) * xPixelsPerMs, startY, intervalMs * xPixelsPerMs, sampleHeight);
    }

  }

  render() {
    this._scheduleDraw();
    return <canvas className={this.props.className} ref='canvas'/>;
  }

}

Histogram.propTypes = {
  'thread': PropTypes.shape({
    samples: PropTypes.object.isRequired,
  }).isRequired,
  'interval': PropTypes.number.isRequired,
  'rangeStart': PropTypes.number.isRequired,
  'rangeEnd': PropTypes.number.isRequired,
  'funcStackInfo': PropTypes.shape({
    'funcStackTable': PropTypes.object.isRequired,
    'sampleFuncStacks': PropTypes.object.isRequired,
  }).isRequired,
  'selectedFuncStack': PropTypes.number.isRequired,
  'className': PropTypes.string,
};

export default Histogram;
