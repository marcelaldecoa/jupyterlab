// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import {
  ILayoutRestorer, JupyterLab, JupyterLabPlugin
} from '@jupyterlab/application';

import {
  Dialog, ICommandPalette, IFrame, InstanceTracker, showDialog
} from '@jupyterlab/apputils';

import {
  PageConfig, URLExt
} from '@jupyterlab/coreutils';

import {
  IMainMenu
} from '@jupyterlab/mainmenu';

import {
  KernelMessage
} from '@jupyterlab/services';

import {
  Message
} from '@phosphor/messaging';

import {
  Menu, PanelLayout, Widget
} from '@phosphor/widgets';

import * as React from 'react';

import '../style/index.css';

/**
 * The command IDs used by the help plugin.
 */
namespace CommandIDs {
  export
  const open = 'help:open';

  export
  const about = 'help:about';

  export
  const activate = 'help:activate';

  export
  const close = 'help:close';

  export
  const show = 'help:show';

  export
  const hide = 'help:hide';

  export
  const toggle = 'help:toggle';

  export
  const launchClassic = 'help:launch-classic-notebook';
}


/**
 * A flag denoting whether the application is loaded over HTTPS.
 */
const LAB_IS_SECURE = window.location.protocol === 'https:';

/**
 * The class name added to the help widget.
 */
const HELP_CLASS = 'jp-Help';

/**
 * A list of help resources.
 */

const RESOURCES = [
  {
    text: 'JupyterLab Reference',
    url: 'https://jupyterlab.readthedocs.io/en/stable/'
  },
  {
    text: 'Notebook Reference',
    url: 'https://jupyter-notebook.readthedocs.io/en/latest/'
  },
  {
    text: 'Markdown Reference',
    url: 'https://help.github.com/articles/' +
      'getting-started-with-writing-and-formatting-on-github/'
  }
];

RESOURCES.sort((a: any, b: any) => {
  return a.text.localeCompare(b.text);
});


/**
 * The help handler extension.
 */
const plugin: JupyterLabPlugin<void> = {
  activate,
  id: '@jupyterlab/help-extension:plugin',
  requires: [IMainMenu, ICommandPalette, ILayoutRestorer],
  autoStart: true
};


/**
 * Export the plugin as default.
 */
export default plugin;

/*
  * An IFrame the disposes itself when closed.
  *
  * This is needed to clear the state restoration db when IFrames are closed.
 */
class HelpWidget extends Widget {
  /**
   * Construct a new help widget.
   */
  constructor(url: string) {
    super();
    let layout = this.layout = new PanelLayout();
    let iframe = new IFrame();
    this.url = iframe.url = url;
    layout.addWidget(iframe);
  }

  /**
   * The url of the widget.
   */
  readonly url: string;

  /**
   * Handle activate requests for the widget.
   */
  protected onActivateRequest(msg: Message): void {
    this.node.tabIndex = -1;
    this.node.focus();
  }

  /**
   * Dispose of the IFrame when closing.
   */
  protected onCloseRequest(msg: Message): void {
    this.dispose();
  }
}


/**
 * Activate the help handler extension.
 *
 * @param app - The phosphide application object.
 *
 * returns A promise that resolves when the extension is activated.
 */
function activate(app: JupyterLab, mainMenu: IMainMenu, palette: ICommandPalette, restorer: ILayoutRestorer): void {
  let counter = 0;
  const category = 'Help';
  const namespace = 'help-doc';
  const baseUrl = PageConfig.getBaseUrl();
  const { commands, shell, info, serviceManager } = app;
  const tracker = new InstanceTracker<HelpWidget>({ namespace });

  // Handle state restoration.
  restorer.restore(tracker, {
    command: CommandIDs.open,
    args: widget => ({ url: widget.url, text: widget.title.label }),
    name: widget => widget.url
  });

  /**
   * Create a new HelpWidget widget.
   */
  function newClosableIFrame(url: string, text: string): HelpWidget {
    let iframe = new HelpWidget(url);
    iframe.addClass(HELP_CLASS);
    iframe.title.label = text;
    iframe.title.closable = true;
    iframe.id = `${namespace}-${++counter}`;
    tracker.add(iframe);
    return iframe;
  }

  // Populate the Help menu.
  const helpMenu = mainMenu.helpMenu;
  const labGroup = [
    CommandIDs.about,
    'faq-jupyterlab:open',
    CommandIDs.launchClassic
  ].map(command => { return { command }; });
  helpMenu.addGroup(labGroup, 0);
  const resourcesGroup = RESOURCES
    .map(args => ({ args, command: CommandIDs.open }));
  helpMenu.addGroup(resourcesGroup, 10);

  // Generate a cache of the kernel help links.
  const kernelInfoCache = new Map<string, KernelMessage.IInfoReply>();
  serviceManager.sessions.runningChanged.connect((m, sessions) => {
    // If a new session has been added, it is at the back
    // of the session list. If one has changed or stopped,
    // it does not hurt to check it.
    if (!sessions.length) {
      return;
    }
    const sessionModel = sessions[sessions.length - 1];
    if (kernelInfoCache.has(sessionModel.kernel.name)) {
      return;
    }
    serviceManager.sessions.connectTo(sessionModel).then(session => {
      session.kernel.ready.then(() => {
        // Check the cache second time so that, if two callbacks get scheduled,
        // they don't try to add the same commands.
        if (kernelInfoCache.has(sessionModel.kernel.name)) {
          return;
        }
        // Set the Kernel Info cache.
        const name = session.kernel.name;
        const kernelInfo = session.kernel.info;
        kernelInfoCache.set(name, kernelInfo);

        // Utility function to check if the current widget
        // has registered itself with the help menu.
        const usesKernel = () => {
          let result = false;
          const widget = app.shell.currentWidget;
          if (!widget) {
            return result;
          }
          helpMenu.kernelUsers.forEach(u => {
            if (u.tracker.has(widget) &&
                u.getKernel(widget) &&
                u.getKernel(widget).name === name) {
              result = true;
            }
          });
          return result;
        };

        // Add the kernel banner to the Help Menu.
        const bannerCommand = `help-menu-${name}:banner`;
        const spec = serviceManager.specs.kernelspecs[name];
        const kernelName = spec.display_name;
        let kernelIconUrl = spec.resources['logo-64x64'];
        if (kernelIconUrl) {
          let index = kernelIconUrl.indexOf('kernelspecs');
          kernelIconUrl = baseUrl + kernelIconUrl.slice(index);
        }
        commands.addCommand(bannerCommand, {
          label: `About the ${kernelName} Kernel`,
          isVisible: usesKernel,
          isEnabled: usesKernel,
          execute: () => {
            // Create the header of the about dialog
            let headerLogo = (<img src={kernelIconUrl} />);
            let title = (
              <span className='jp-About-header'>,
                {headerLogo},
                <div className='jp-About-header-info'>{kernelName}</div>
              </span>
            );
            const banner = (<pre>{kernelInfo.banner}</pre>);
            let body = (
              <div className='jp-About-body'>
                {banner}
              </div>
            );

            showDialog({
              title,
              body,
              buttons: [
                Dialog.createButton({
                  label: 'DISMISS',
                  className: 'jp-About-button jp-mod-reject jp-mod-styled'
                })
              ]
            });
          }
        });
        helpMenu.addGroup([{ command: bannerCommand }], 20);

        // Add the kernel info help_links to the Help menu.
        const kernelGroup: Menu.IItemOptions[] = [];
        (session.kernel.info.help_links || []).forEach((link) => {
          const commandId = `help-menu-${name}:${link.text}`;
          commands.addCommand(commandId, {
            label: link.text,
            isVisible: usesKernel,
            isEnabled: usesKernel,
            execute: () => { commands.execute(CommandIDs.open, link); }
          });
          kernelGroup.push({ command: commandId });
        });
        helpMenu.addGroup(kernelGroup, 21);

        // Dispose of the session object since we no longer need it.
        session.dispose();
      });
    });
  });

  commands.addCommand(CommandIDs.about, {
    label: `About ${info.name}`,
    execute: () => {

      // Create the header of the about dialog
      let headerLogo = (<div className='jp-About-header-logo'/>);
      let headerWordmark = (<div className='jp-About-header-wordmark'/>);
      let release = 'Beta Release Series';
      let versionNumber = `Version ${info.version}`;
      let versionInfo = (
        <span className='jp-About-version-info'>
          <span className='jp-About-release'>{release}</span>
          <span className='jp-About-version'>{versionNumber}</span>
        </span>
      );
      let title = (
        <span className='jp-About-header'>
          {headerLogo},
          <div className='jp-About-header-info'>
            {headerWordmark}
            {versionInfo}
          </div>
        </span>
      );

      // Create the body of the about dialog
      let jupyterURL = 'https://jupyter.org/about.html';
      let contributorsURL = 'https://github.com/jupyterlab/jupyterlab/graphs/contributors';
      let externalLinks = (
        <span className='jp-About-externalLinks'>
          <a
            href={contributorsURL}
            target='_blank'
            className='jp-Button-flat'
          >CONTRIBUTOR LIST</a>
          <a
            href={jupyterURL}
            target='_blank'
            className='jp-Button-flat'
          >ABOUT PROJECT JUPYTER</a>
        </span>
      );
      let copyright = (
        <span
          className='jp-About-copyright'
        >© 2018 Project Jupyter</span>
      );
      let body = (
        <div className='jp-About-body'>
          {externalLinks}
          {copyright}
        </div>
      );

      showDialog({
        title,
        body,
        buttons: [
          Dialog.createButton({
            label: 'DISMISS',
            className: 'jp-About-button jp-mod-reject jp-mod-styled'
          })
        ]
      });
    }
  });

  commands.addCommand(CommandIDs.open, {
    label: args => args['text'] as string,
    execute: args => {
      const url = args['url'] as string;
      const text = args['text'] as string;

      // If help resource will generate a mixed content error, load externally.
      if (LAB_IS_SECURE && URLExt.parse(url).protocol !== 'https:') {
        window.open(url);
        return;
      }

      let iframe = newClosableIFrame(url, text);
      shell.addToMainArea(iframe);
      shell.activateById(iframe.id);
    }
  });


  commands.addCommand(CommandIDs.launchClassic, {
    label: 'Launch Classic Notebook',
    execute: () => { window.open(PageConfig.getBaseUrl() + 'tree'); }
  });

  RESOURCES.forEach(args => {
    palette.addItem({ args, command: CommandIDs.open, category });
  });
  palette.addItem({ command: 'apputils:reset', category });
  palette.addItem({ command: CommandIDs.launchClassic, category });

}
