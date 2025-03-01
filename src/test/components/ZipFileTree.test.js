/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// @flow
import * as React from 'react';
import { ZipFileViewer } from '../../components/app/ZipFileViewer';
import { Provider } from 'react-redux';

import { render, screen } from 'firefox-profiler/test/fixtures/testing-library';
import * as UrlStateSelectors from '../../selectors/url-state';
import * as ZippedProfileSelectors from '../../selectors/zipped-profiles';

import { storeWithZipFile } from '../fixtures/profiles/zip-file';
import { autoMockCanvasContext } from '../fixtures/mocks/canvas-context';
import {
  getBoundingBox,
  waitUntilState,
  fireFullClick,
} from '../fixtures/utils';

describe('calltree/ZipFileTree', function() {
  autoMockCanvasContext();

  async function setup() {
    const { store } = await storeWithZipFile([
      'foo/bar/profile1.json',
      'foo/profile2.json',
      'baz/profile3.json',
      // Use a file with a big depth to test the automatic expansion at load time.
      'boat/ship/new/anything/explore/yes/profile4.json',
    ]);

    // This makes the bounding box large enough so that we don't trigger
    // VirtualList's virtualization.
    jest
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(() => getBoundingBox(1000, 2000));

    const renderResult = render(
      <Provider store={store}>
        <ZipFileViewer />
      </Provider>
    );
    const { getState, dispatch } = store;
    return { ...renderResult, store, getState, dispatch };
  }

  it('renders a zip file tree', async () => {
    const { container } = await setup();
    expect(container.firstChild).toMatchSnapshot();
  });

  // getByText is an assertion, but eslint doesn't know that.
  // eslint-disable-next-line jest/expect-expect
  it('contains a list of all the files', async () => {
    await setup();

    // We're looping through all expected files and check if we can find an
    // element with the file name as text content.
    // getByText throws if it doesn't find an element with this text content.
    [
      'foo',
      'bar',
      'profile1.json',
      'profile2.json',
      'baz',
      'profile3.json',
    ].forEach(fileName => screen.getByText(fileName));
  });

  describe('clicking on a profile link', function() {
    const setupClickingTest = async () => {
      const setupResult = await setup();
      const { store, container } = setupResult;

      const profile1OpenLink = screen.getByText('profile1.json');

      const waitUntilDoneProcessingZip = () =>
        waitUntilState(
          store,
          state =>
            ZippedProfileSelectors.getZipFileState(state).phase ===
            'VIEW_PROFILE_IN_ZIP_FILE'
        );

      function profileViewer() {
        return container.querySelector('.profileViewer');
      }

      return {
        ...setupResult,
        profile1OpenLink,
        waitUntilDoneProcessingZip,
        profileViewer,
      };
    };

    it('starts out without any path in the zip file', async () => {
      const { getState, profileViewer } = await setupClickingTest();
      expect(UrlStateSelectors.getPathInZipFileFromUrl(getState())).toBe(null);
      expect(profileViewer()).toBeFalsy();
    });

    it('kicks off the profile loading process when clicked', async () => {
      const {
        getState,
        profile1OpenLink,
        waitUntilDoneProcessingZip,
        profileViewer,
      } = await setupClickingTest();
      fireFullClick(profile1OpenLink);
      expect(UrlStateSelectors.getPathInZipFileFromUrl(getState())).toBe(
        'foo/bar/profile1.json'
      );

      // The profile isn't actually viewed yet.
      expect(profileViewer()).toBeFalsy();
      expect(
        screen.getByText(/Loading the profile/).textContent
      ).toMatchSnapshot();

      // There is async behavior going on. Wait until it is done or else
      // redux-react will throw an error.
      await waitUntilDoneProcessingZip();
    });

    it('will show the ProfileViewer component when done processing', async () => {
      const {
        profileViewer,
        profile1OpenLink,
        waitUntilDoneProcessingZip,
      } = await setupClickingTest();

      fireFullClick(profile1OpenLink);
      await waitUntilDoneProcessingZip();
      expect(profileViewer()).toBeTruthy();
    });
  });
});
