/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
// @flow

import React, { PureComponent } from 'react';
import classNames from 'classnames';
import { ensureExists } from 'firefox-profiler/utils/flow';
import { timeCode } from 'firefox-profiler/utils/time-code';
import {
  getSampleIndexToCallNodeIndex,
  getSamplesSelectedStates,
  getSampleIndexClosestToCenteredTime,
} from 'firefox-profiler/profile-logic/profile-data';
import { bisectionRight } from 'firefox-profiler/utils/bisect';
import { BLUE_70, BLUE_40 } from 'photon-colors';

import './SampleGraph.css';

import type {
  Thread,
  CategoryList,
  IndexIntoSamplesTable,
  Milliseconds,
  CallNodeInfo,
  IndexIntoCallNodeTable,
} from 'firefox-profiler/types';

type Props = {|
  +className: string,
  +thread: Thread,
  +tabFilteredThread: Thread,
  +interval: Milliseconds,
  +rangeStart: Milliseconds,
  +rangeEnd: Milliseconds,
  +callNodeInfo: CallNodeInfo,
  +selectedCallNodeIndex: IndexIntoCallNodeTable | null,
  +categories: CategoryList,
  +onSampleClick: (
    event: SyntheticMouseEvent<>,
    sampleIndex: IndexIntoSamplesTable
  ) => void,
  +trackName: string,
|};

export class ThreadSampleGraph extends PureComponent<Props> {
  _canvas: null | HTMLCanvasElement = null;
  _resizeListener: () => void;
  _takeCanvasRef = (canvas: HTMLCanvasElement | null) =>
    (this._canvas = canvas);
  _resizeListener = () => this.forceUpdate();

  _renderCanvas() {
    const canvas = this._canvas;
    if (canvas !== null) {
      timeCode('ThreadSampleGraph render', () => {
        this.drawCanvas(canvas);
      });
    }
  }

  componentDidMount() {
    window.addEventListener('resize', this._resizeListener);
    this.forceUpdate(); // for initial size
  }

  componentWillUnmount() {
    window.removeEventListener('resize', this._resizeListener);
  }

  drawCanvas(canvas: HTMLCanvasElement) {
    const {
      thread,
      tabFilteredThread,
      interval,
      rangeStart,
      rangeEnd,
      callNodeInfo,
      selectedCallNodeIndex,
      categories,
    } = this.props;

    const devicePixelRatio = canvas.ownerDocument
      ? canvas.ownerDocument.defaultView.devicePixelRatio
      : 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * devicePixelRatio);
    canvas.height = Math.round(rect.height * devicePixelRatio);
    const ctx = canvas.getContext('2d');
    let maxDepth = 0;
    const { callNodeTable, stackIndexToCallNodeIndex } = callNodeInfo;
    const sampleCallNodes = getSampleIndexToCallNodeIndex(
      thread.samples.stack,
      stackIndexToCallNodeIndex
    );
    const tabFilteredSampleCallNodes = getSampleIndexToCallNodeIndex(
      tabFilteredThread.samples.stack,
      stackIndexToCallNodeIndex
    );
    // This is currently too slow to compute for the JS Tracer threads.
    const samplesSelectedStates = thread.isJsTracer
      ? null
      : getSamplesSelectedStates(
          callNodeTable,
          sampleCallNodes,
          tabFilteredSampleCallNodes,
          selectedCallNodeIndex
        );
    for (let i = 0; i < callNodeTable.depth.length; i++) {
      if (callNodeTable.depth[i] > maxDepth) {
        maxDepth = callNodeTable.depth[i];
      }
    }
    const range = [rangeStart, rangeEnd];
    const rangeLength = range[1] - range[0];
    const xPixelsPerMs = canvas.width / rangeLength;
    const trueIntervalPixelWidth = interval * xPixelsPerMs;
    const multiplier = trueIntervalPixelWidth < 2.0 ? 1.2 : 1.0;
    const drawnIntervalWidth = Math.max(
      0.8,
      trueIntervalPixelWidth * multiplier
    );
    const drawnSampleWidth = Math.min(drawnIntervalWidth, 10);

    const firstDrawnSampleTime = range[0] - drawnIntervalWidth / xPixelsPerMs;
    const lastDrawnSampleTime = range[1];

    const firstDrawnSampleIndex = bisectionRight(
      thread.samples.time,
      firstDrawnSampleTime
    );
    const afterLastDrawnSampleIndex = bisectionRight(
      thread.samples.time,
      lastDrawnSampleTime,
      firstDrawnSampleIndex
    );

    // Do one pass over the samples array to gather the samples we want to draw.
    const regularSamples = [];
    const idleSamples = [];
    const highlightedSamples = [];
    // Enforce a minimum distance so that we don't draw more than 4 samples per
    // pixel.
    const minGapMs = 0.25 / xPixelsPerMs;
    let nextMinTime = -Infinity;
    for (let i = firstDrawnSampleIndex; i < afterLastDrawnSampleIndex; i++) {
      const sampleTime = thread.samples.time[i];
      if (sampleTime < nextMinTime) {
        continue;
      }
      const callNodeIndex = sampleCallNodes[i];
      if (callNodeIndex === null) {
        continue;
      }
      const xPos =
        (sampleTime - range[0]) * xPixelsPerMs - drawnSampleWidth / 2;
      let samplesBucket;
      if (
        samplesSelectedStates !== null &&
        samplesSelectedStates[i] === 'SELECTED'
      ) {
        samplesBucket = highlightedSamples;
      } else {
        const stackIndex = ensureExists(
          thread.samples.stack[i],
          'A stack must exist for this sample, since a callNodeIndex exists.'
        );
        const categoryIndex = thread.stackTable.category[stackIndex];
        const category = categories[categoryIndex];
        if (category.name === 'Idle') {
          samplesBucket = idleSamples;
        } else {
          samplesBucket = regularSamples;
        }
      }
      samplesBucket.push(xPos);
      nextMinTime = sampleTime + minGapMs;
    }

    function drawSamples(samplePositions: number[], color: string) {
      for (let i = 0; i < samplePositions.length; i++) {
        ctx.fillStyle = color;
        const startY = 0;
        const xPos = samplePositions[i];
        ctx.fillRect(xPos, startY, drawnSampleWidth, canvas.height);
      }
    }

    // Draw the samples in multiple passes, separated by color. This reduces the calls
    // to ctx.fillStyle, which saves on time that's spent parsing color strings.
    const lighterBlue = '#c5e1fe';
    drawSamples(regularSamples, BLUE_40);
    drawSamples(highlightedSamples, BLUE_70);
    drawSamples(idleSamples, lighterBlue);
  }

  _onMouseUp = (event: SyntheticMouseEvent<>) => {
    const canvas = this._canvas;
    if (canvas) {
      const { rangeStart, rangeEnd, thread } = this.props;
      const r = canvas.getBoundingClientRect();

      const x = event.pageX - r.left;
      const time = rangeStart + (x / r.width) * (rangeEnd - rangeStart);

      const sampleIndex = getSampleIndexClosestToCenteredTime(
        thread.samples,
        time
      );

      if (thread.samples.stack[sampleIndex] === null) {
        // If the sample index refers to a null sample, that sample
        // has been filtered out and means that there was no stack bar
        // drawn at the place where the user clicked. Do nothing here.
        return;
      }

      this.props.onSampleClick(event, sampleIndex);
    }
  };

  render() {
    this._renderCanvas();
    const { className, trackName } = this.props;
    return (
      <div className={className}>
        <canvas
          className={classNames(
            `${this.props.className}Canvas`,
            'threadSampleGraphCanvas'
          )}
          ref={this._takeCanvasRef}
          onMouseUp={this._onMouseUp}
        >
          <h2>Stack Graph for {trackName}</h2>
          <p>This graph charts the stack height of each sample.</p>
        </canvas>
      </div>
    );
  }
}
