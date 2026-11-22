#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import "../tools/gmt-synthetic-boundary.h"
@interface Probe : NSObject <WKNavigationDelegate,WKUIDelegate>
@property (strong) WKWebView *view;
@property NSInteger allowedPort;
@end
@implementation Probe
- (void)webView:(WKWebView *)view decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))handler {
    NSURL *u=action.request.URL;
    BOOL allowed=GMTTestAllowsNavigation(u,self.allowedPort);
    if (!allowed) fprintf(stderr,"NAV_BLOCKED %s\n",u.absoluteString.UTF8String);
    handler(allowed?WKNavigationActionPolicyAllow:WKNavigationActionPolicyCancel);
}
- (void)webView:(WKWebView *)view decidePolicyForNavigationResponse:(WKNavigationResponse *)response decisionHandler:(void (^)(WKNavigationResponsePolicy))handler {
    NSURL *u=response.response.URL;
    BOOL allowed=GMTTestAllowsNavigation(u,self.allowedPort);
    handler(allowed?WKNavigationResponsePolicyAllow:WKNavigationResponsePolicyCancel);
}
- (WKWebView *)webView:(WKWebView *)webView createWebViewWithConfiguration:(WKWebViewConfiguration *)configuration forNavigationAction:(WKNavigationAction *)action windowFeatures:(WKWindowFeatures *)features { fprintf(stderr,"POPUP_BLOCKED\n");return nil; }
- (void)webView:(WKWebView *)view didFinishNavigation:(WKNavigation *)navigation {
    if (![view.URL.path isEqualToString:@"/probe"]) return;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,6*NSEC_PER_SEC),dispatch_get_main_queue(),^{
        [view evaluateJavaScript:@"JSON.stringify({url:location.href, events:window.events||[]})" completionHandler:^(id result,NSError *error){
            if(error)fprintf(stderr,"EVALUATION_ERROR\n"); else printf("RESULT %s\n",[result UTF8String]);
            fflush(stdout); [NSApp terminate:nil];
        }];
    });
}
@end
int main(int argc, const char *argv[]) { @autoreleasepool {
    if(argc!=2)return 2; NSInteger port=atoi(argv[1]); if(port<1024||port>65535)return 2;
    NSApplication *app=[NSApplication sharedApplication]; [app setActivationPolicy:NSApplicationActivationPolicyProhibited];
    Probe *p=[Probe new];p.allowedPort=port;
    NSString *rules=GMTTestContentRules(port);
    [[WKContentRuleListStore defaultStore] compileContentRuleListForIdentifier:@"gmt-fictional-probe" encodedContentRuleList:rules completionHandler:^(WKContentRuleList *list,NSError *error){
        if(error||!list){fprintf(stderr,"RULES_ERROR %s\n",error.localizedDescription.UTF8String);[app terminate:nil];return;}
        WKWebViewConfiguration *config=[WKWebViewConfiguration new];config.websiteDataStore=[WKWebsiteDataStore nonPersistentDataStore];[config.userContentController addContentRuleList:list];
        p.view=[[WKWebView alloc] initWithFrame:NSMakeRect(0,0,900,600) configuration:config];p.view.navigationDelegate=p;p.view.UIDelegate=p;
        [p.view loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:[NSString stringWithFormat:@"http://localhost:%ld/probe",(long)port]]]];
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW,12*NSEC_PER_SEC),dispatch_get_main_queue(),^{fprintf(stderr,"TIMEOUT\n");[app terminate:nil];});
    }]; [app run];
}return 0;}
