// Package exchangewaf registers the request-only EXCHANGE_XML Coraza body processor.
package exchangewaf

import (
	"bufio"
	"encoding/base64"
	"encoding/xml"
	"fmt"
	"io"
	"maps"
	"strings"

	"github.com/corazawaf/coraza/v3/experimental/plugins"
	"github.com/corazawaf/coraza/v3/experimental/plugins/plugintypes"
)

const ewsTypes = "http://schemas.microsoft.com/exchange/services/2006/types"
const xmlNamespace = "http://www.w3.org/XML/1998/namespace"
const xmlnsNamespace = "http://www.w3.org/2000/xmlns/"

type processor struct{}

func init() {
	plugins.RegisterBodyProcessor("exchange_xml", func() plugintypes.BodyProcessor { return &processor{} })
}

func (*processor) ProcessRequest(reader io.Reader, vars plugintypes.TransactionVariables, options plugintypes.BodyProcessorOptions) error {
	attrs, text, err := readXML(reader, options)
	if err != nil {
		return err
	}
	vars.RequestXML().Set("//@*", attrs)
	vars.RequestXML().Set("/*", text)
	return nil
}

func (*processor) ProcessResponse(io.Reader, plugintypes.TransactionVariables, plugintypes.BodyProcessorOptions) error {
	return fmt.Errorf("EXCHANGE_XML supports request bodies only")
}

type frame struct {
	raw, name  xml.Name
	namespaces map[string]string
}

func readXML(reader io.Reader, options plugintypes.BodyProcessorOptions) ([]string, []string, error) {
	input := bufio.NewReader(reader)
	if prefix, _ := input.Peek(3); string(prefix) == "\uFEFF" {
		_, _ = input.Discard(3)
	}
	dec := xml.NewDecoder(input)
	depthLimit := 128
	if options.RequestBodyRecursionLimit > 0 && options.RequestBodyRecursionLimit < depthLimit {
		depthLimit = options.RequestBodyRecursionLimit
	}
	var stack []frame
	var attrs, text []string
	var pending strings.Builder
	roots, arguments := 0, 0
	sawToken := false
	reserve := func(count int) error {
		if options.ArgumentLimit > 0 && count > options.ArgumentLimit-arguments {
			return fmt.Errorf("EXCHANGE_XML argument limit exceeded")
		}
		arguments += count
		return nil
	}
	flush := func() error {
		value := strings.TrimSpace(pending.String())
		pending.Reset()
		if value != "" {
			if err := reserve(1); err != nil {
				return err
			}
			text = append(text, value)
		}
		return nil
	}
	for {
		// Decoder accepts fragments; only literal XML whitespace may surround the single root.
		if len(stack) == 0 {
			for {
				prefix, err := input.Peek(1)
				if err != nil {
					break
				}
				if strings.IndexByte(" \t\r\n", prefix[0]) < 0 {
					if prefix[0] != '<' {
						return nil, nil, fmt.Errorf("text outside XML root")
					}
					break
				}
				_, _ = input.Discard(1)
				sawToken = true
			}
		}
		// RawToken leaves namespace and matching-tag validation to the bounded stack below.
		token, err := dec.RawToken()
		if err == io.EOF {
			if len(stack) != 0 || roots != 1 {
				return nil, nil, fmt.Errorf("incomplete XML document")
			}
			return attrs, text, nil
		}
		if err != nil {
			return nil, nil, err
		}
		switch tok := token.(type) {
		case xml.StartElement:
			if err := flush(); err != nil {
				return nil, nil, err
			}
			if len(stack) >= depthLimit {
				return nil, nil, fmt.Errorf("EXCHANGE_XML depth limit exceeded")
			}
			if len(stack) == 0 {
				roots++
				if roots != 1 {
					return nil, nil, fmt.Errorf("multiple XML roots")
				}
			}
			if err := reserve(len(tok.Attr)); err != nil {
				return nil, nil, err
			}
			ns := map[string]string{"xml": xmlNamespace}
			if len(stack) > 0 {
				ns = stack[len(stack)-1].namespaces
			}
			current, err := resolveStart(tok, ns)
			if err != nil {
				return nil, nil, err
			}
			for _, attr := range tok.Attr {
				attrs = append(attrs, attr.Value)
				// CRS primarily targets /*, so inspect attributes there as well without counting twice.
				text = append(text, attr.Value)
			}
			stack = append(stack, current)
			if binaryElement(stack) {
				content := &binaryReader{decoder: dec, end: tok.Name}
				if _, err := io.Copy(io.Discard, base64.NewDecoder(base64.StdEncoding.Strict(), content)); err != nil {
					return nil, nil, fmt.Errorf("invalid EWS base64 content: %w", err)
				}
				// A padded decoder may stop before asking its source for the closing tag.
				var probe [1]byte
				if n, err := content.Read(probe[:]); n != 0 || err != io.EOF {
					return nil, nil, fmt.Errorf("trailing or malformed EWS base64 content")
				}
				stack = stack[:len(stack)-1]
			}
		case xml.EndElement:
			if err := flush(); err != nil {
				return nil, nil, err
			}
			if len(stack) == 0 || stack[len(stack)-1].raw != tok.Name {
				return nil, nil, fmt.Errorf("mismatched XML closing tag")
			}
			stack = stack[:len(stack)-1]
		case xml.CharData:
			if len(stack) == 0 {
				return nil, nil, fmt.Errorf("text outside XML root")
			} else {
				pending.Write(tok)
			}
		case xml.Directive:
			return nil, nil, fmt.Errorf("XML declarations and entities are not allowed")
		case xml.ProcInst:
			if tok.Target != "xml" || sawToken {
				return nil, nil, fmt.Errorf("XML processing instructions are not allowed")
			}
		}
		sawToken = true
	}
}

func resolveStart(start xml.StartElement, parent map[string]string) (frame, error) {
	ns := parent
	cloned := false
	seen := make(map[xml.Name]bool, len(start.Attr))
	for _, attr := range start.Attr {
		if seen[attr.Name] {
			return frame{}, fmt.Errorf("duplicate XML attribute")
		}
		seen[attr.Name] = true
		if attr.Name.Space == "xmlns" || attr.Name.Space == "" && attr.Name.Local == "xmlns" {
			prefix := attr.Name.Local
			if attr.Name.Space == "" {
				prefix = ""
			}
			if prefix == "xmlns" || attr.Value == xmlnsNamespace || prefix == "xml" && attr.Value != xmlNamespace || prefix != "xml" && attr.Value == xmlNamespace || prefix != "" && attr.Value == "" {
				return frame{}, fmt.Errorf("invalid XML namespace declaration")
			}
			if !cloned {
				ns = maps.Clone(parent)
				cloned = true
			}
			ns[prefix] = attr.Value
		}
	}
	resolve := func(name xml.Name, element bool) (xml.Name, error) {
		if strings.Contains(name.Local, ":") || name.Local == "" || name.Space == "xmlns" {
			return xml.Name{}, fmt.Errorf("invalid XML qualified name")
		}
		if name.Space == "" {
			if element {
				name.Space = ns[""]
			}
			return name, nil
		}
		uri, ok := ns[name.Space]
		if !ok {
			return xml.Name{}, fmt.Errorf("undeclared XML namespace prefix")
		}
		name.Space = uri
		return name, nil
	}
	name, err := resolve(start.Name, true)
	if err != nil {
		return frame{}, err
	}
	clear(seen)
	for _, attr := range start.Attr {
		if attr.Name.Space == "xmlns" || attr.Name.Space == "" && attr.Name.Local == "xmlns" {
			continue
		}
		expanded, err := resolve(attr.Name, false)
		if err != nil {
			return frame{}, err
		}
		if seen[expanded] {
			return frame{}, fmt.Errorf("duplicate expanded XML attribute")
		}
		seen[expanded] = true
	}
	return frame{raw: start.Name, name: name, namespaces: ns}, nil
}

func binaryElement(stack []frame) bool {
	if len(stack) < 4 {
		return false
	}
	root, body := stack[0].name, stack[1].name
	if root.Local != "Envelope" || root.Space != "http://schemas.xmlsoap.org/soap/envelope/" && root.Space != "http://www.w3.org/2003/05/soap-envelope" || body != (xml.Name{Space: root.Space, Local: "Body"}) {
		return false
	}
	parent, current := stack[len(stack)-2].name, stack[len(stack)-1].name
	if current.Space != ewsTypes || parent.Space != ewsTypes {
		return false
	}
	if current.Local == "Content" {
		return parent.Local == "FileAttachment"
	}
	if current.Local != "MimeContent" {
		return false
	}
	// Microsoft EWS MimeContent's documented item parents; no name-only or wildcard match.
	switch parent.Local {
	case "CalendarItem", "Contact", "DistributionList", "Item", "MeetingCancellation", "MeetingMessage", "MeetingRequest", "MeetingResponse", "Message", "RemoveItem", "Task":
		return true
	}
	return false
}

type binaryReader struct {
	decoder *xml.Decoder
	end     xml.Name
	pending []byte
	done    bool
}

func (r *binaryReader) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	n := 0
	for n < len(p) {
		if len(r.pending) == 0 {
			if r.done {
				return n, io.EOF
			}
			token, err := r.decoder.RawToken()
			if err != nil {
				if err == io.EOF {
					err = io.ErrUnexpectedEOF
				}
				return n, err
			}
			switch tok := token.(type) {
			case xml.CharData:
				r.pending = tok
			case xml.EndElement:
				if tok.Name != r.end {
					return n, fmt.Errorf("mismatched binary closing tag")
				}
				r.done = true
				return n, io.EOF
			default:
				return n, fmt.Errorf("markup inside EWS binary content")
			}
		}
		for len(r.pending) > 0 && n < len(p) {
			b := r.pending[0]
			r.pending = r.pending[1:]
			if b != ' ' && b != '\t' && b != '\r' && b != '\n' {
				p[n] = b
				n++
			}
		}
	}
	return n, nil
}
