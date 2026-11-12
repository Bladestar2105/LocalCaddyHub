package exchangewaf

import (
	"bytes"
	"fmt"
	"io"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"testing/iotest"

	"github.com/corazawaf/coraza/v3"
	"github.com/corazawaf/coraza/v3/experimental/plugins/plugintypes"
	"github.com/corazawaf/coraza/v3/types"
)

const typesNS = "http://schemas.microsoft.com/exchange/services/2006/types"
const soap11 = "http://schemas.xmlsoap.org/soap/envelope/"
const soap12 = "http://www.w3.org/2003/05/soap-envelope"

func envelope(content string) string {
	return `<s:Envelope xmlns:s="` + soap11 + `" xmlns:t="` + typesNS + `"><s:Body>` + content + `</s:Body></s:Envelope>`
}

func runTransaction(t testing.TB, body, config string) (plugintypes.TransactionVariables, *types.Interruption) {
	t.Helper()
	waf, err := coraza.NewWAF(coraza.NewWAFConfig().WithDirectives(`
SecRuleEngine On
SecRequestBodyAccess On
SecRequestBodyLimit 33554432
SecRequestBodyNoFilesLimit 33554432
SecAction "id:100,phase:1,pass,nolog,ctl:requestBodyProcessor=EXCHANGE_XML"
SecRule REQBODY_ERROR "!@eq 0" "id:101,phase:2,deny,status:400,nolog"
` + config))
	if err != nil {
		t.Fatal(err)
	}
	if closer, ok := waf.(io.Closer); ok {
		t.Cleanup(func() { closer.Close() })
	}
	tx := waf.NewTransaction()
	t.Cleanup(func() { tx.Close() })
	tx.ProcessConnection("127.0.0.1", 1234, "127.0.0.1", 443)
	tx.ProcessURI("/EWS/Exchange.asmx", "POST", "HTTP/1.1")
	tx.AddRequestHeader("Content-Type", "text/xml; charset=utf-8")
	if interruption := tx.ProcessRequestHeaders(); interruption != nil {
		t.Fatalf("header interruption: %+v", interruption)
	}
	if interruption, _, err := tx.WriteRequestBody([]byte(body)); err != nil || interruption != nil {
		t.Fatalf("write body: %+v, %v", interruption, err)
	}
	interruption, err := tx.ProcessRequestBody()
	if err != nil {
		t.Fatal(err)
	}
	reader, err := tx.RequestBodyReader()
	if err != nil {
		t.Fatal(err)
	}
	forwarded, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(forwarded, []byte(body)) {
		t.Fatal("changed the forwarded request body")
	}
	vars := tx.(interface {
		Variables() plugintypes.TransactionVariables
	}).Variables()
	if vars.RequestBody().Get() != "" {
		t.Fatal("populated or changed REQUEST_BODY instead of XML collections")
	}
	return vars, interruption
}

func TestBinaryScopeAndPreservedMetadata(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		want       []string
	}{
		{"attachment", envelope(`<t:FileAttachment><t:Name>report.txt</t:Name><t:Content>QUJD</t:Content></t:FileAttachment>`), []string{"report.txt"}},
		{"soap12", strings.ReplaceAll(envelope(`<t:FileAttachment><t:Content>QUJD</t:Content></t:FileAttachment>`), soap11, soap12), nil},
		{"default namespace", `<Envelope xmlns="` + soap11 + `"><Body><FileAttachment xmlns="` + typesNS + `"><Content>QUJD</Content></FileAttachment></Body></Envelope>`, nil},
		{"wrong content namespace", envelope(`<t:FileAttachment><Content>QUJD</Content></t:FileAttachment>`), []string{"QUJD"}},
		{"wrong parent namespace", envelope(`<FileAttachment><t:Content>QUJD</t:Content></FileAttachment>`), []string{"QUJD"}},
		{"wrong parent", envelope(`<t:Message><t:Content>QUJD</t:Content></t:Message>`), []string{"QUJD"}},
		{"indirect parent", envelope(`<t:FileAttachment><t:Other><t:Content>QUJD</t:Content></t:Other></t:FileAttachment>`), []string{"QUJD"}},
		{"outside SOAP", `<root xmlns:t="` + typesNS + `"><t:FileAttachment><t:Content>QUJD</t:Content></t:FileAttachment></root>`, []string{"QUJD"}},
		{"SOAP header", strings.Replace(envelope(`<t:FileAttachment><t:Content>QUJD</t:Content></t:FileAttachment>`), "s:Body", "s:Header", 2), []string{"QUJD"}},
		{"wrong SOAP namespace", strings.ReplaceAll(envelope(`<t:FileAttachment><t:Content>QUJD</t:Content></t:FileAttachment>`), soap11, "urn:untrusted"), []string{"QUJD"}},
		{"namespace rebound", envelope(`<t:FileAttachment xmlns:t="urn:untrusted"><t:Content>QUJD</t:Content></t:FileAttachment>`), []string{"QUJD"}},
		{"mime wrong parent", envelope(`<t:FileAttachment><t:MimeContent>QUJD</t:MimeContent></t:FileAttachment>`), []string{"QUJD"}},
		{"other binary looking metadata", envelope(`<t:Message><t:Subject>QUJD</t:Subject></t:Message>`), []string{"QUJD"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			vars, intr := runTransaction(t, tc.body, "")
			if intr != nil {
				t.Fatalf("unexpected block: %+v (%s)", intr, vars.RequestBodyErrorMsg().Get())
			}
			got := vars.RequestXML().Get("/*")
			for _, want := range tc.want {
				if !contains(got, want) {
					t.Fatalf("XML inspection missing %q: %v", want, got)
				}
			}
			if !contains(tc.want, "QUJD") && contains(got, "QUJD") {
				t.Fatalf("XML inspection contains attachment data: %v", got)
			}
		})
	}
	for _, parent := range []string{"CalendarItem", "Contact", "DistributionList", "Item", "MeetingCancellation", "MeetingMessage", "MeetingRequest", "MeetingResponse", "Message", "RemoveItem", "Task"} {
		t.Run("mime "+parent, func(t *testing.T) {
			vars, intr := runTransaction(t, envelope(`<t:`+parent+`><t:MimeContent CharacterSet="utf-8">QUJD</t:MimeContent></t:`+parent+`>`), "")
			if intr != nil {
				t.Fatal(intr)
			}
			if contains(vars.RequestXML().Get("/*"), "QUJD") {
				t.Fatal("exposed binary MIME data")
			}
			if !strings.Contains(strings.Join(vars.RequestXML().Get("//@*"), "|"), "utf-8") {
				t.Fatal("lost MIME attributes")
			}
		})
	}
}

func TestMetadataAndAttributesRemainInspected(t *testing.T) {
	rules := `SecRule XML:/* "@contains METADATA_ATTACK" "id:102,phase:2,deny,status:403,nolog"`
	for _, body := range []string{
		envelope(`<t:FileAttachment><t:Name>METADATA_ATTACK</t:Name><t:Content>QUJD</t:Content></t:FileAttachment>`),
		envelope(`<t:Message><t:MimeContent CharacterSet="METADATA_ATTACK">QUJD</t:MimeContent></t:Message>`),
		envelope(`<t:FileAttachment><t:Content label="METADATA_ATTACK">QUJD</t:Content></t:FileAttachment>`),
		envelope(`<t:Subject>META<![CDATA[DATA_]]>ATTACK</t:Subject>`),
		envelope(`<t:Subject xmlns:x="urn:METADATA_ATTACK">safe</t:Subject>`),
	} {
		_, intr := runTransaction(t, body, rules)
		if intr == nil || intr.Status != 403 {
			t.Fatalf("metadata bypass: %+v", intr)
		}
	}
}

func TestMalformedOrUnboundedXMLFailsClosed(t *testing.T) {
	for _, inner := range []string{
		`<t:FileAttachment><t:Content>not base64!</t:Content></t:FileAttachment>`,
		`<t:FileAttachment><t:Content>QUJD<hidden>attack</hidden></t:Content></t:FileAttachment>`,
		`<t:FileAttachment><t:Content>QQ==QUJD</t:Content></t:FileAttachment>`,
		`<t:FileAttachment><t:Content>QR==</t:Content></t:FileAttachment>`,
		`<t:FileAttachment><t:Content>QUJD` + "\u00a0" + `</t:Content></t:FileAttachment>`,
		`<t:Subject>&unknown;</t:Subject>`,
		`<t:Subject a="one" a="two">safe</t:Subject>`,
		`<unbound:Subject>safe</unbound:Subject>`,
		`<t:Subject>safe</t:Other>`,
		strings.Repeat(`<a>`, 129) + strings.Repeat(`</a>`, 129),
	} {
		body := envelope(inner)
		vars, intr := runTransaction(t, body, "")
		if intr == nil || intr.Status != 400 {
			t.Errorf("accepted malformed XML: %.100s (%s)", inner, vars.RequestBodyErrorMsg().Get())
		}
	}
	for _, body := range []string{`<!DOCTYPE x [<!ENTITY x "test">]>` + envelope(`<t:Subject>&x;</t:Subject>`), envelope("") + `<another/>`, envelope("") + `garbage`, envelope(`<t:Subject>unfinished`)} {
		_, intr := runTransaction(t, body, "")
		if intr == nil || intr.Status != 400 {
			t.Fatalf("accepted invalid document: %.100s", body)
		}
	}
	for _, config := range []string{"SecArgumentsLimit 3", "SecRequestBodyJsonDepthLimit 3"} {
		_, intr := runTransaction(t, envelope(`<a><b><c>one</c><d>two</d><e>three</e><f>four</f></b></a>`), config)
		if intr == nil || intr.Status != 400 {
			t.Fatalf("ignored limit %s", config)
		}
	}
}

func TestBase64AcrossCDATAAndWhitespace(t *testing.T) {
	for _, value := range []string{"Q<![CDATA[U]]>J\n D\t", " Q Q = = \r\n", ""} {
		vars, intr := runTransaction(t, envelope(`<t:FileAttachment><t:Content>`+value+`</t:Content></t:FileAttachment><t:Subject>visible</t:Subject>`), "")
		if intr != nil {
			t.Fatalf("valid binary rejected: %+v, %s", intr, vars.RequestBodyErrorMsg().Get())
		}
		if got := vars.RequestXML().Get("/*"); !reflect.DeepEqual(got, []string{soap11, typesNS, "visible"}) {
			t.Fatalf("text=%v", got)
		}
	}
}

func TestLargeAttachmentHasSmallInspectionSurface(t *testing.T) {
	body := envelope(`<t:FileAttachment><t:Name>large.bin</t:Name><t:Content>` + strings.Repeat("QUJD", 5*1024*1024) + `</t:Content></t:FileAttachment>`)
	vars, intr := runTransaction(t, body, `SecRule XML:/* "@contains QUJD" "id:103,phase:2,deny,status:403,nolog"`)
	if intr != nil {
		t.Fatalf("binary leaked to inspection: %+v, %s", intr, vars.RequestBodyErrorMsg().Get())
	}
	if got := vars.RequestXML().Get("/*"); !reflect.DeepEqual(got, []string{soap11, typesNS, "large.bin"}) {
		t.Fatalf("inspection contains %d values instead of metadata only", len(got))
	}
	for _, value := range vars.RequestXML().FindAll() {
		if len(value.Value()) > len(typesNS) {
			t.Fatal("binary retained in XML collection")
		}
	}
}

func BenchmarkLargeAttachment(b *testing.B) {
	body := envelope(`<t:FileAttachment><t:Content>` + strings.Repeat("QUJD", 5*1024*1024) + `</t:Content></t:FileAttachment>`)
	b.SetBytes(int64(len(body)))
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, intr := runTransaction(b, body, "")
		if intr != nil {
			b.Fatal(fmt.Sprint(intr))
		}
	}
}

func TestStreamingParserValidatesBinaryAndAllXML(t *testing.T) {
	body := `<?xml version="1.0"?>` + envelope(`<t:FileAttachment label="retained"><t:Content>Q<![CDATA[U]]>J&#x20;D</t:Content></t:FileAttachment><t:Subject>safe &amp; &lt;metadata&gt;</t:Subject>`)
	for _, reader := range []io.Reader{strings.NewReader(body), iotest.OneByteReader(strings.NewReader(body)), iotest.HalfReader(strings.NewReader(body))} {
		attrs, text, err := readXML(reader, plugintypes.BodyProcessorOptions{ArgumentLimit: 100, RequestBodyRecursionLimit: 128})
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(text, []string{soap11, typesNS, "retained", "safe & <metadata>"}) {
			t.Fatalf("text=%v", text)
		}
		if !reflect.DeepEqual(attrs, []string{soap11, typesNS, "retained"}) {
			t.Fatalf("attrs=%v", attrs)
		}
	}
	for _, body := range []string{
		envelope(`<t:FileAttachment><t:Content>QUJD<!-- hidden -->QUJD</t:Content></t:FileAttachment>`),
		envelope(`<t:FileAttachment><t:Content>QQ==<?hidden attack?></t:Content></t:FileAttachment>`),
		envelope(`<a xmlns:x="urn:test" xmlns:y="urn:test" x:name="a" y:name="b"/>`),
		envelope(`<t:Subject xmlns:xml="urn:wrong">text</t:Subject>`),
		envelope(`<t:Subject xmlns:x="` + xmlNamespace + `">text</t:Subject>`),
		envelope(`<t:Subject xmlns:x="">text</t:Subject>`),
		envelope(`<t:Subject xmlns:xmlns="urn:x">text</t:Subject>`),
		envelope(`<t:Subject xmlns:x:y="urn:x">text</t:Subject>`),
		envelope(`<t:Subject><?hidden attack?></t:Subject>`),
		envelope(`<t:Subject>safe</x:Subject>`),
	} {
		if _, _, err := readXML(iotest.OneByteReader(strings.NewReader(body)), plugintypes.BodyProcessorOptions{}); err == nil {
			t.Fatalf("accepted invalid XML: %.150s", body)
		}
	}
}

func TestScopeDoesNotBroadenAcrossNamespaceOrSOAPChanges(t *testing.T) {
	for _, body := range []string{
		strings.Replace(envelope(`<t:FileAttachment><t:Content>QUJD</t:Content></t:FileAttachment>`), `<s:Body>`, `<s:Body xmlns:s="urn:wrong">`, 1),
		envelope(`<t:FileAttachment><t:Content xmlns:t="urn:wrong">QUJD</t:Content></t:FileAttachment>`),
		envelope(`<t:FileAttachment><t:content>QUJD</t:content></t:FileAttachment>`),
		envelope(`<t:Message><t:MimeContentUTF8>QUJD</t:MimeContentUTF8></t:Message>`),
	} {
		_, text, err := readXML(strings.NewReader(body), plugintypes.BodyProcessorOptions{})
		if err != nil {
			t.Fatal(err)
		}
		if !contains(text, "QUJD") {
			t.Fatalf("hidden non-allowlisted text: %v", text)
		}
	}
}

func TestParserHonorsLimitsAndReaderFailures(t *testing.T) {
	for _, options := range []plugintypes.BodyProcessorOptions{{ArgumentLimit: 2}, {RequestBodyRecursionLimit: 2}} {
		if _, _, err := readXML(strings.NewReader(envelope(`<t:Subject>visible</t:Subject>`)), options); err == nil {
			t.Fatalf("ignored limit: %+v", options)
		}
	}
	if _, _, err := readXML(iotest.ErrReader(fmt.Errorf("upstream read failed")), plugintypes.BodyProcessorOptions{}); err == nil {
		t.Fatal("ignored reader failure")
	}
}

func TestXMLDocumentWhitespaceAndBOM(t *testing.T) {
	for _, prefix := range []string{"\uFEFF \r\n", "\uFEFF<?xml version=\"1.0\"?>", " \t\r\n"} {
		if _, _, err := readXML(strings.NewReader(prefix+envelope("")), plugintypes.BodyProcessorOptions{}); err != nil {
			t.Fatalf("rejected valid XML prefix %q: %v", prefix, err)
		}
	}
	for _, prefix := range []string{"\u00a0", "\uFEFF\uFEFF", "&#65279;", "&#32;", "<![CDATA[ ]]>", " <?xml version=\"1.0\"?>"} {
		if _, _, err := readXML(strings.NewReader(prefix+envelope("")), plugintypes.BodyProcessorOptions{}); err == nil {
			t.Fatalf("accepted invalid XML prefix %q", prefix)
		}
	}
	if _, _, err := readXML(strings.NewReader(envelope("")+"&#32;"), plugintypes.BodyProcessorOptions{}); err == nil {
		t.Fatal("accepted character reference outside root")
	}
}

func BenchmarkLargeAttachmentParser(b *testing.B) {
	body := envelope(`<t:FileAttachment><t:Content>` + strings.Repeat("QUJD", 5*1024*1024) + `</t:Content></t:FileAttachment>`)
	b.SetBytes(int64(len(body)))
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, text, err := readXML(strings.NewReader(body), plugintypes.BodyProcessorOptions{ArgumentLimit: 1000, RequestBodyRecursionLimit: 128})
		if err != nil || !reflect.DeepEqual(text, []string{soap11, typesNS}) {
			b.Fatalf("parse: %v; %d text values", err, len(text))
		}
	}
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func TestMirroredAttributesCountOnlyOnce(t *testing.T) {
	_, intr := runTransaction(t, envelope(`<t:Subject label="retained">visible</t:Subject>`), "SecArgumentsLimit 4")
	if intr != nil {
		t.Fatalf("counted mirrored attributes twice: %+v", intr)
	}
}

func TestNamespaceScopeDoesNotAmplifySmallDocuments(t *testing.T) {
	var body strings.Builder
	body.WriteString("<root")
	for i := 0; i < 990; i++ {
		fmt.Fprintf(&body, " xmlns:p%d=\"urn:%d\"", i, i)
	}
	body.WriteByte('>')
	body.WriteString(strings.Repeat("<e/>", 20000))
	body.WriteString("</root>")
	input := body.String()
	runtime.GC()
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	attrs, _, err := readXML(strings.NewReader(input), plugintypes.BodyProcessorOptions{ArgumentLimit: 1000})
	runtime.ReadMemStats(&after)
	if err != nil {
		t.Fatal(err)
	}
	if len(attrs) != 990 {
		t.Fatalf("lost namespace metadata: %d", len(attrs))
	}
	allocated := after.TotalAlloc - before.TotalAlloc
	t.Logf("%d-byte namespace-heavy document allocated %d bytes", len(input), allocated)
	if allocated > 32*1024*1024 {
		t.Fatalf("%d-byte XML allocated %d bytes; namespace scope copied for each empty element", len(input), allocated)
	}
}

func TestNamespaceRebindingDoesNotChangeSiblings(t *testing.T) {
	body := envelope(`<t:FileAttachment xmlns:t="urn:other"><t:Content>QUJD</t:Content></t:FileAttachment><t:FileAttachment><t:Content>QUJD</t:Content></t:FileAttachment>`)
	_, text, err := readXML(strings.NewReader(body), plugintypes.BodyProcessorOptions{})
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, value := range text {
		if value == "QUJD" {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("sibling namespace leaked: %d binary-looking metadata values", count)
	}
}
