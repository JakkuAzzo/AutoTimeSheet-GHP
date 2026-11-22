#import <Foundation/Foundation.h>
#import "../tools/gmt-synthetic-boundary.h"
static void require(BOOL value, NSString *message) { if (!value) { fprintf(stderr,"FAIL %s\n",message.UTF8String);exit(1); } }
static BOOL resourceAllowedForTypeFrom(NSArray *rules, NSString *url, NSString *type, NSString *mainDomain) {
    BOOL blocked=NO;
    for(NSDictionary *rule in rules) {
        NSString *pattern=rule[@"trigger"][@"url-filter"];
        NSArray *types=rule[@"trigger"][@"resource-type"];if(types && ![types containsObject:type])continue;
        NSArray *domains=rule[@"trigger"][@"if-domain"];if(domains && ![domains containsObject:mainDomain])continue;
        NSRegularExpression *r=[NSRegularExpression regularExpressionWithPattern:pattern options:NSRegularExpressionCaseInsensitive error:nil];
        require(r!=nil,@"invalid rule pattern");
        if([r firstMatchInString:url options:0 range:NSMakeRange(0,url.length)]) blocked=[rule[@"action"][@"type"] isEqualToString:@"block"];
    }
    return !blocked;
}
static BOOL resourceAllowed(NSArray *rules, NSString *url) { return resourceAllowedForTypeFrom(rules,url,@"raw",@"localhost"); }
int main(int argc,const char *argv[]) { @autoreleasepool {
    require(argc==2,@"fixture path required");
    NSURL *fixture=[NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[1]]];
    require(GMTTestFixtureIsAllowed(fixture),@"prepared fictional file rejected");
    NSString *tmp=[NSTemporaryDirectory() stringByAppendingPathComponent:[[NSUUID UUID] UUIDString]];
    [[NSFileManager defaultManager] createDirectoryAtPath:tmp withIntermediateDirectories:YES attributes:nil error:nil];
    NSURL *wrong=[NSURL fileURLWithPath:[tmp stringByAppendingPathComponent:@"GMT-FICTIONAL-PORTAL-UPLOAD.json"]];
    [@"different bytes" writeToURL:wrong atomically:YES encoding:NSUTF8StringEncoding error:nil];
    require(!GMTTestFixtureIsAllowed(wrong),@"incorrect bytes accepted");
    NSURL *wrongName=[NSURL fileURLWithPath:[tmp stringByAppendingPathComponent:@"other.json"]];
    [[NSFileManager defaultManager] copyItemAtURL:fixture toURL:wrongName error:nil];
    require(!GMTTestFixtureIsAllowed(wrongName),@"incorrect name accepted");
    [[NSFileManager defaultManager] removeItemAtPath:tmp error:nil];
    NSData *badJSON=[GMTTestContentRules(0) dataUsingEncoding:NSUTF8StringEncoding];
    NSArray *badRules=[NSJSONSerialization JSONObjectWithData:badJSON options:0 error:nil];require(!resourceAllowed(badRules,@"https://gmt-services.co.uk/portal/"),@"invalid port must fail closed");
    NSArray *allow=@[@"http://localhost:4179/portal/",@"https://login.microsoftonline.com/tenant/oauth2/authorize"];
    NSArray *deny=@[@"http://localhost:4180/",@"http://localhost:4179.evil.test/",@"http://user@localhost:4179/",@"https://login.microsoftonline.com.evil.test/",@"https://user@login.microsoftonline.com/",@"https://login.microsoftonline.com:444/",@"http://login.microsoftonline.com/",@"https://gmt-timesheet-portal-e2e-20261116.raspy-breeze-e230.workers.dev/api/profile",@"file:///tmp/example"];
    for(NSString *s in allow)require(GMTTestAllowsNavigation([NSURL URLWithString:s],4179),s);
    for(NSString *s in deny)require(!GMTTestAllowsNavigation([NSURL URLWithString:s],4179),s);
    NSData *json=[GMTTestContentRules(4179) dataUsingEncoding:NSUTF8StringEncoding];
    NSArray *rules=[NSJSONSerialization JSONObjectWithData:json options:0 error:nil];require(rules.count>1,@"rules missing");
    NSArray *resources=@[@"http://localhost:4179/portal/",@"https://login.microsoftonline.com/tenant",@"https://gmt-timesheet-portal-e2e-20261116.raspy-breeze-e230.workers.dev/api/profile"];
    NSArray *blocked=@[@"http://localhost:4180/",@"http://localhost:4179.evil.test/",@"http://user@localhost:4179/",@"https://login.microsoftonline.com.evil.test/",@"https://login.microsoftonline.com:444/",@"https://gmt-timesheet-portal-e2e-20261116.raspy-breeze-e230.workers.dev.evil.test/",@"https://gmt-services.co.uk/portal/",@"https://formsubmit.co/test"];
    for(NSString *s in resources)require(resourceAllowed(rules,s),s);
    for(NSString *s in @[@"https://aadcdn.msauth.net/fixture.js",@"https://aadcdn.msftauth.net/fixture.css"]) {
      require(resourceAllowedForTypeFrom(rules,s,@"script",@"login.microsoftonline.com"),@"Microsoft sign-in script blocked");
      require(resourceAllowedForTypeFrom(rules,s,@"style-sheet",@"login.microsoftonline.com"),@"Microsoft sign-in style blocked");
      require(!resourceAllowedForTypeFrom(rules,s,@"raw",@"login.microsoftonline.com"),@"Microsoft asset host accepted an arbitrary request");
      require(!GMTTestAllowsNavigation([NSURL URLWithString:s],4179),@"asset host accepted navigation");
      require(!resourceAllowedForTypeFrom(rules,s,@"script",@"localhost"),@"portal may not load sign-in assets");
    }
    for(NSString *s in blocked)require(!resourceAllowed(rules,s),s);
    puts("PASS policy");
}return 0;}
