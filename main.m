//
//  main.m
//  Kept Photo Booth Native macOS Kiosk Application
//
#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <Security/Security.h>

@interface AppDelegate : NSObject <NSApplicationDelegate, WKUIDelegate, WKNavigationDelegate>
@property (strong, nonatomic) NSWindow *window;
@property (strong, nonatomic) WKWebView *webView;
@property (strong, nonatomic) NSTask *serverTask;
@end

@implementation AppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)aNotification {
    // 1. Setup Main Kiosk Window
    NSScreen *screen = [NSScreen mainScreen];
    NSRect screenRect = screen ? screen.visibleFrame : NSMakeRect(0, 0, 1280, 800);
    CGFloat width = MIN(1200, screenRect.size.width - 60);
    CGFloat height = MIN(860, screenRect.size.height - 60);
    NSRect windowRect = NSMakeRect((screenRect.size.width - width) / 2 + screenRect.origin.x,
                                   (screenRect.size.height - height) / 2 + screenRect.origin.y,
                                   width, height);

    NSWindowStyleMask style = NSWindowStyleMaskTitled |
                              NSWindowStyleMaskClosable |
                              NSWindowStyleMaskMiniaturizable |
                              NSWindowStyleMaskResizable |
                              NSWindowStyleMaskFullSizeContentView;

    self.window = [[NSWindow alloc] initWithContentRect:windowRect
                                              styleMask:style
                                                backing:NSBackingStoreBuffered
                                                  defer:NO];

    self.window.title = @"Kept Photo Booth";
    self.window.titleVisibility = NSWindowTitleHidden;
    self.window.titlebarAppearsTransparent = YES;
    self.window.backgroundColor = [NSColor colorWithCalibratedRed:0.04 green:0.04 blue:0.07 alpha:1.0];
    self.window.collectionBehavior = NSWindowCollectionBehaviorFullScreenPrimary;
    self.window.minSize = NSMakeSize(900, 600);

    // 3. Configure WKWebView with Camera, Audio & Local Storage
    WKWebViewConfiguration *config = [[WKWebViewConfiguration alloc] init];
    config.mediaTypesRequiringUserActionForPlayback = WKAudiovisualMediaTypeNone;
    
    // Enable developer extras for debugging if needed
    @try {
        [config.preferences setValue:@YES forKey:@"developerExtrasEnabled"];
        [config.preferences setValue:@YES forKey:@"mediaDevicesEnabled"];
    } @catch (NSException *e) {}

    self.webView = [[WKWebView alloc] initWithFrame:self.window.contentView.bounds configuration:config];
    self.webView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    self.webView.UIDelegate = self;
    self.webView.navigationDelegate = self;
    self.webView.wantsLayer = YES;
    self.webView.layer.backgroundColor = CGColorGetConstantColor(kCGColorBlack);

    [self.window.contentView addSubview:self.webView];

    // 4. Setup Application Menu (Cmd+Q, Cmd+W, Cmd+F, Cmd+R)
    [self setupMainMenu];

    // 5. Load Photo Booth URL
    [self loadBoothPage];

    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
}

- (void)ensureServerRunning {
    // Check if port 8443 or 8080 is responding
    NSURL *testUrl = [NSURL URLWithString:@"http://127.0.0.1:8080/manifest.json"];
    NSURLRequest *req = [NSURLRequest requestWithURL:testUrl cachePolicy:NSURLRequestReloadIgnoringLocalCacheData timeoutInterval:0.8];
    
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    __block BOOL serverIsUp = NO;
    
    [[[NSURLSession sharedSession] dataTaskWithRequest:req completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
        if (!error && [(NSHTTPURLResponse *)response statusCode] == 200) {
            serverIsUp = YES;
        }
        dispatch_semaphore_signal(sem);
    }] resume];
    
    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.0 * NSEC_PER_SEC)));

    if (!serverIsUp) {
        // Start server_https.py in background
        NSString *resourcePath = [[NSBundle mainBundle] resourcePath];
        NSString *serverScript = [resourcePath stringByAppendingPathComponent:@"web/server_https.py"];
        
        if (![[NSFileManager defaultManager] fileExistsAtPath:serverScript]) {
            serverScript = @"/Users/admin/Documents/app photo Booth/server_https.py";
        }

        if ([[NSFileManager defaultManager] fileExistsAtPath:serverScript]) {
            self.serverTask = [[NSTask alloc] init];
            self.serverTask.launchPath = @"/usr/bin/python3";
            self.serverTask.currentDirectoryPath = [serverScript stringByDeletingLastPathComponent];
            self.serverTask.arguments = @[serverScript];
            @try {
                [self.serverTask launch];
                NSLog(@"✓ Kept Photo Booth Local Server started in background");
            } @catch (NSException *e) {
                NSLog(@"Failed to launch server: %@", e);
            }
        }
    }
}

- (void)loadBoothPage {
    // Primary: Live Cloudflare Workers & D1 Database URL
    NSURL *targetUrl = [NSURL URLWithString:@"https://kept-photo-booth.brfkorat6442brf.workers.dev"];
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:targetUrl
                                                           cachePolicy:NSURLRequestReloadIgnoringLocalCacheData
                                                       timeoutInterval:15.0];
    [self.webView loadRequest:request];
}

#pragma mark - WKNavigationDelegate

- (void)webView:(WKWebView *)webView didReceiveAuthenticationChallenge:(NSURLAuthenticationChallenge *)challenge completionHandler:(void (^)(NSURLSessionAuthChallengeDisposition, NSURLCredential * _Nullable))completionHandler {
    // Automatically accept self-signed HTTPS certificate on localhost fallback
    if ([challenge.protectionSpace.host isEqualToString:@"localhost"] || [challenge.protectionSpace.host isEqualToString:@"127.0.0.1"]) {
        SecTrustRef trust = challenge.protectionSpace.serverTrust;
        completionHandler(NSURLSessionAuthChallengeUseCredential, [[NSURLCredential alloc] initWithTrust:trust]);
        return;
    }
    completionHandler(NSURLSessionAuthChallengePerformDefaultHandling, nil);
}

- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error {
    NSString *failedUrl = webView.URL.absoluteString ?: @"";
    NSLog(@"Navigation failed (%@): %@", failedUrl, error.localizedDescription);

    if ([failedUrl containsString:@"workers.dev"] || failedUrl.length == 0) {
        // Offline fallback: start local server and load localhost
        [self ensureServerRunning];
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.0 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
            NSURL *localHttps = [NSURL URLWithString:@"https://localhost:8443"];
            [webView loadRequest:[NSURLRequest requestWithURL:localHttps]];
        });
    } else if ([failedUrl containsString:@"8443"]) {
        NSURL *fallbackUrl = [NSURL URLWithString:@"http://localhost:8080"];
        [webView loadRequest:[NSURLRequest requestWithURL:fallbackUrl]];
    }
}

#pragma mark - WKUIDelegate (Camera Permission & Dialogs)

- (void)webView:(WKWebView *)webView requestMediaCapturePermissionForOrigin:(WKSecurityOrigin *)origin initiatedByFrame:(WKFrameInfo *)frame type:(WKMediaCaptureType)type decisionHandler:(void (^)(WKPermissionDecision decision))decisionHandler {
    // Auto grant camera & microphone to Photo Booth
    decisionHandler(WKPermissionDecisionGrant);
}

- (void)webView:(WKWebView *)webView runJavaScriptAlertPanelWithMessage:(NSString *)message initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(void))completionHandler {
    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = @"Kept Photo Booth";
    alert.informativeText = message;
    [alert addButtonWithTitle:@"ตกลง (OK)"];
    [alert runModal];
    completionHandler();
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
    return YES;
}

- (void)applicationWillTerminate:(NSNotification *)notification {
    if (self.serverTask && [self.serverTask isRunning]) {
        [self.serverTask terminate];
    }
}

#pragma mark - Main Menu Setup

- (void)setupMainMenu {
    NSMenu *menubar = [[NSMenu alloc] init];
    
    // App Menu
    NSMenuItem *appMenuItem = [[NSMenuItem alloc] init];
    [menubar addItem:appMenuItem];
    NSMenu *appMenu = [[NSMenu alloc] initWithTitle:@"Kept Photo Booth"];
    [appMenu addItemWithTitle:@"เกี่ยวกับ Kept Photo Booth" action:@selector(showAbout) keyEquivalent:@""];
    [appMenu addItem:[NSMenuItem separatorItem]];
    [appMenu addItemWithTitle:@"ซ่อน Kept Photo Booth" action:@selector(hide:) keyEquivalent:@"h"];
    [appMenu addItemWithTitle:@"ออก (Quit)" action:@selector(terminate:) keyEquivalent:@"q"];
    [appMenuItem setSubmenu:appMenu];

    // View Menu (Full Screen, Reload)
    NSMenuItem *viewMenuItem = [[NSMenuItem alloc] init];
    [menubar addItem:viewMenuItem];
    NSMenu *viewMenu = [[NSMenu alloc] initWithTitle:@"มุมมอง (View)"];
    [viewMenu addItemWithTitle:@"รีเฟรช (Reload)" action:@selector(reloadBooth) keyEquivalent:@"r"];
    [viewMenu addItemWithTitle:@"โหมดเต็มจอ Kiosk (Full Screen)" action:@selector(toggleFullScreen:) keyEquivalent:@"f"];
    [viewMenuItem setSubmenu:viewMenu];

    // Window Menu
    NSMenuItem *windowMenuItem = [[NSMenuItem alloc] init];
    [menubar addItem:windowMenuItem];
    NSMenu *windowMenu = [[NSMenu alloc] initWithTitle:@"หน้าต่าง (Window)"];
    [windowMenu addItemWithTitle:@"ย่อหน้าต่าง (Minimize)" action:@selector(performMiniaturize:) keyEquivalent:@"m"];
    [windowMenu addItemWithTitle:@"ปิดหน้าต่าง (Close)" action:@selector(performClose:) keyEquivalent:@"w"];
    [windowMenuItem setSubmenu:windowMenu];

    [NSApp setMainMenu:menubar];
}

- (void)reloadBooth {
    [self.webView reload];
}

- (void)showAbout {
    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = @"Kept Photo Booth";
    alert.informativeText = @"แอปพลิเคชันตู้ถ่ายรูป Kept Photo Booth v2.6\nรองรับกล้องถ่ายภาพ, โหมด Kiosk เต็มจอ, กรอบรูปหนังสือพิมพ์/สลิป และซิงค์ Google Drive";
    [alert addButtonWithTitle:@"ตกลง"];
    [alert runModal];
}

@end

int main(int argc, const char * argv[]) {
    @autoreleasepool {
        NSApplication *app = [NSApplication sharedApplication];
        AppDelegate *delegate = [[AppDelegate alloc] init];
        app.delegate = delegate;
        [app setActivationPolicy:NSApplicationActivationPolicyRegular];
        [app run];
    }
    return 0;
}
