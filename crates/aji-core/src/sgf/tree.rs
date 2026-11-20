//! The SGF tree as the file has it: sequences of nodes, each followed by its variations.

/// One property: an uppercase identifier and its values, unescaped.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SgfProp {
    pub id: String,
    pub values: Vec<String>,
}

/// One node: its properties in file order. A property appears once; repeats are merged.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SgfNode {
    pub props: Vec<SgfProp>,
}

impl SgfNode {
    pub fn get(&self, id: &str) -> Option<&SgfProp> {
        self.props.iter().find(|p| p.id == id)
    }

    /// The first value of `id`.
    pub fn first(&self, id: &str) -> Option<&str> {
        self.get(id)?.values.first().map(String::as_str)
    }

    /// Appends `values` to `id`, adding the property at the end if it is new.
    pub fn push(&mut self, id: &str, values: impl IntoIterator<Item = String>) {
        match self.props.iter_mut().find(|p| p.id == id) {
            Some(prop) => prop.values.extend(values),
            None => self.props.push(SgfProp {
                id: id.to_owned(),
                values: values.into_iter().collect(),
            }),
        }
    }
}

/// A game tree: a sequence of nodes, then the variations that branch after its last node.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SgfTree {
    pub nodes: Vec<SgfNode>,
    pub variations: Vec<SgfTree>,
}
