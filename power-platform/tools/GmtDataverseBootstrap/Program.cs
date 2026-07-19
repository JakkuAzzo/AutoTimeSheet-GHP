using Azure.Core;
using Azure.Identity;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

const string organizationUrl = "https://gmt-portal-dev.crm4.dynamics.com";
const string tenantId = "8b182d6b-6f34-4ca2-84ad-50ca712b5488";
const string publicClientId = "51f81489-12ee-4a9e-aaae-a2591f45987d";

var apply = args.Contains("--apply", StringComparer.OrdinalIgnoreCase);
var credential = new DeviceCodeCredential(new DeviceCodeCredentialOptions
{
    TenantId = tenantId,
    ClientId = publicClientId,
    DeviceCodeCallback = (code, _) =>
    {
        Console.WriteLine(code.Message);
        return Task.CompletedTask;
    }
});

var accessToken = await credential.GetTokenAsync(
    new TokenRequestContext(new[] { $"{organizationUrl}/.default" }));

using var client = new HttpClient { BaseAddress = new Uri($"{organizationUrl}/api/data/v9.2/") };
client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken.Token);
client.DefaultRequestHeaders.Add("OData-MaxVersion", "4.0");
client.DefaultRequestHeaders.Add("OData-Version", "4.0");
client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

var tables = new[]
{
    new Table("gmt_timesheetsubmission", "Timesheet Submission", "Timesheet Submissions", new[]
    {
        Text("Record ID", 250), Text("Submission ID", 250), Text("Employee", 200), Text("Employee UPN", 320),
        Text("Employee Email", 320), Date("Week Start"), Date("Week End"), Integer("Absence Count"),
        Decimal("Worked Hours"), Decimal("Basic Hours"), Decimal("OT 1.5 Hours"), Decimal("OT 2.0 Hours"),
        Text("Status", 100), DateTime("Submitted At"), Text("SharePoint Folder Link", 1000),
        Text("XLSX Link", 1000), Text("CSV Link", 1000), Text("Source Email Subject", 500)
    }),
    new Table("gmt_clockevent", "Clock Event", "Clock Events", new[]
    {
        Text("Record ID", 250), Text("Employee", 200), Text("Employee UPN", 320), Text("Event Type", 100),
        DateTime("Event Time"), Date("Event Date"), Text("Source Reference", 250), DateTime("Submitted At")
    }),
    new Table("gmt_auditsubmission", "Audit Submission", "Audit Submissions", new[]
    {
        Text("Record ID", 250), Text("Audit Name", 250), Integer("Parsed Files"), Integer("Parsed Rows"),
        Integer("Warnings"), Integer("Parse Errors"), Text("Status", 100), DateTime("Submitted At"),
        Text("SharePoint Folder Link", 1000), Text("Workbook Link", 1000), Text("Warnings CSV Link", 1000),
        Text("Source Email Subject", 500)
    }),
    new Table("gmt_jobcard", "Job Card", "Job Cards", new[]
    {
        Text("Record ID", 250), Text("Job Reference", 200), Text("Client", 200), Text("Site Address", 500),
        Text("Assigned Engineer", 200), Date("Planned Start"), Date("Planned End"), Text("Status", 100),
        Memo("Description", 4000), Text("Attachment Folder Link", 1000), Text("Outlook Event ID", 500),
        Text("Calendar Sync Status", 100), Memo("Calendar Sync Error", 4000), DateTime("Last Calendar Sync")
    }),
    new Table("gmt_task", "Task", "Tasks", new[]
    {
        Text("Record ID", 250), Text("Requester UPN", 320), Text("Job Reference", 200), Text("Assigned To", 200),
        Date("Due Date"), Text("Priority", 100), Text("Status", 100), Memo("Notes", 4000),
        Text("Outlook Event ID", 500), Text("Calendar Sync Status", 100), Memo("Calendar Sync Error", 4000),
        DateTime("Last Calendar Sync")
    }),
    new Table("gmt_calendarevent", "Calendar Event", "Calendar Events", new[]
    {
        Text("Source Type", 100), Text("Source Record ID", 250), Text("Calendar Name", 200), Date("Event Date"),
        Text("Status", 100), Text("Outlook Event ID", 500), Text("Calendar Sync Status", 100),
        Memo("Calendar Sync Error", 4000), DateTime("Last Calendar Sync"), Memo("Notes", 4000)
    })
};

foreach (var table in tables)
{
    var exists = await ExistsAsync(table.LogicalName);
    Console.WriteLine($"{table.LogicalName}: {(exists ? "exists" : "missing")}");

    if (!apply || exists)
    {
        continue;
    }

    await PostAsync("EntityDefinitions", EntityPayload(table));
    Console.WriteLine($"  created table {table.DisplayName}");

    foreach (var attribute in table.Attributes)
    {
        await PostAsync($"EntityDefinitions(LogicalName='{table.LogicalName}')/Attributes", attribute.Payload);
        Console.WriteLine($"  added {attribute.SchemaName}");
    }
}

Console.WriteLine(apply ? "Schema bootstrap complete." : "Dry run complete. Re-run with --apply to create missing tables.");

async Task<bool> ExistsAsync(string logicalName)
{
    using var response = await client.GetAsync($"EntityDefinitions(LogicalName='{logicalName}')?$select=LogicalName");
    if (response.StatusCode == HttpStatusCode.NotFound)
    {
        return false;
    }

    response.EnsureSuccessStatusCode();
    return true;
}

async Task PostAsync(string path, object payload)
{
    var content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
    using var response = await client.PostAsync(path, content);
    if (response.IsSuccessStatusCode)
    {
        return;
    }

    var details = await response.Content.ReadAsStringAsync();
    throw new InvalidOperationException($"Dataverse request failed ({(int)response.StatusCode}): {details}");
}

static object EntityPayload(Table table) => Payload("Microsoft.Dynamics.CRM.EntityMetadata", new()
{
    ["SchemaName"] = Schema(table.LogicalName),
    ["DisplayName"] = Label(table.DisplayName),
    ["DisplayCollectionName"] = Label(table.DisplayCollectionName),
    ["Description"] = Label($"GMT Staff Portal {table.DisplayName} record."),
    ["OwnershipType"] = "UserOwned",
    ["IsActivity"] = false,
    ["HasActivities"] = false,
    ["PrimaryNameAttribute"] = $"{table.LogicalName}name"
});

static AttributeDefinition Text(string displayName, int maxLength) => new(
    $"gmt_{Token(displayName)}", Payload("Microsoft.Dynamics.CRM.StringAttributeMetadata", new()
    {
        ["SchemaName"] = Schema($"gmt_{Token(displayName)}"), ["DisplayName"] = Label(displayName),
        ["Description"] = Label($"{displayName} for this GMT Staff Portal record."),
        ["RequiredLevel"] = new Dictionary<string, object?> { ["Value"] = "None" }, ["MaxLength"] = maxLength,
        ["FormatName"] = new Dictionary<string, object?> { ["Value"] = "Text" }
    }));

static AttributeDefinition Memo(string displayName, int maxLength) => new(
    $"gmt_{Token(displayName)}", Payload("Microsoft.Dynamics.CRM.MemoAttributeMetadata", new()
    {
        ["SchemaName"] = Schema($"gmt_{Token(displayName)}"), ["DisplayName"] = Label(displayName),
        ["Description"] = Label($"{displayName} for this GMT Staff Portal record."),
        ["RequiredLevel"] = new Dictionary<string, object?> { ["Value"] = "None" }, ["MaxLength"] = maxLength,
        ["Format"] = "Text"
    }));

static AttributeDefinition Date(string displayName) => new(
    $"gmt_{Token(displayName)}", Payload("Microsoft.Dynamics.CRM.DateTimeAttributeMetadata", new()
    {
        ["SchemaName"] = Schema($"gmt_{Token(displayName)}"), ["DisplayName"] = Label(displayName),
        ["Description"] = Label($"{displayName} for this GMT Staff Portal record."),
        ["RequiredLevel"] = new Dictionary<string, object?> { ["Value"] = "None" }, ["Format"] = "DateOnly"
    }));

static AttributeDefinition DateTime(string displayName) => new(
    $"gmt_{Token(displayName)}", Payload("Microsoft.Dynamics.CRM.DateTimeAttributeMetadata", new()
    {
        ["SchemaName"] = Schema($"gmt_{Token(displayName)}"), ["DisplayName"] = Label(displayName),
        ["Description"] = Label($"{displayName} for this GMT Staff Portal record."),
        ["RequiredLevel"] = new Dictionary<string, object?> { ["Value"] = "None" }, ["Format"] = "DateAndTime"
    }));

static AttributeDefinition Decimal(string displayName) => new(
    $"gmt_{Token(displayName)}", Payload("Microsoft.Dynamics.CRM.DecimalAttributeMetadata", new()
    {
        ["SchemaName"] = Schema($"gmt_{Token(displayName)}"), ["DisplayName"] = Label(displayName),
        ["Description"] = Label($"{displayName} for this GMT Staff Portal record."),
        ["RequiredLevel"] = new Dictionary<string, object?> { ["Value"] = "None" }, ["MinValue"] = 0,
        ["MaxValue"] = 1000000, ["Precision"] = 2
    }));

static AttributeDefinition Integer(string displayName) => new(
    $"gmt_{Token(displayName)}", Payload("Microsoft.Dynamics.CRM.IntegerAttributeMetadata", new()
    {
        ["SchemaName"] = Schema($"gmt_{Token(displayName)}"), ["DisplayName"] = Label(displayName),
        ["Description"] = Label($"{displayName} for this GMT Staff Portal record."),
        ["RequiredLevel"] = new Dictionary<string, object?> { ["Value"] = "None" }, ["MinValue"] = 0,
        ["MaxValue"] = 1000000, ["Format"] = "None"
    }));

static Dictionary<string, object?> Payload(string type, Dictionary<string, object?> values)
{
    values["@odata.type"] = type;
    return values;
}

static object Label(string value) => new Dictionary<string, object?>
{
    ["LocalizedLabels"] = new[] { new Dictionary<string, object?> { ["Label"] = value, ["LanguageCode"] = 1033 } }
};

static string Token(string value) => value.ToLowerInvariant()
    .Replace(" ", string.Empty)
    .Replace(".", string.Empty);

static string Schema(string logicalName) => string.Concat(logicalName.Split('_', StringSplitOptions.RemoveEmptyEntries)
    .Select(part => char.ToUpperInvariant(part[0]) + part[1..]));

record Table(string LogicalName, string DisplayName, string DisplayCollectionName, AttributeDefinition[] Attributes);
record AttributeDefinition(string SchemaName, object Payload);
